-- =====================================================================
-- 2026-08-11 - aplicacao fragmentada em producao, arquivada
--
-- ESTE ARQUIVO NAO E UMA MIGRATION. Mora fora de supabase/migrations/ de
-- proposito: o CLI nao deve aplica-lo, e nada aqui deve rodar de novo.
--
-- O QUE E: as 10 entradas que existiam em
-- supabase_migrations.schema_migrations do projeto bqkichuwmugkjumpvrio com
-- versao em timestamp (20260811154552 a 20260811234924) e sem arquivo
-- correspondente no repo. E o SQL que EFETIVAMENTE rodou em producao em
-- 11/08/2026, aplicado em pedacos por ferramenta que versiona com timestamp.
--
-- POR QUE EXISTE: as mudancas foram depois consolidadas nos arquivos numerados
-- 0020-0024, e as 10 entradas removidas do historico do banco em 04/09/2026
-- para alinhar remoto e repo. Antes de remover, o conteudo foi preservado aqui
-- - os arquivos numerados sao a versao consolidada, e nada garante que sejam
-- byte-identicos ao que rodou.
--
-- VERIFICADO ANTES DA REMOCAO: os 18 objetos tocados por estas 10 existem nos
-- arquivos 0020-0024, e nenhuma delas usa `create table` cru - a consolidacao
-- e re-executavel e nao perdeu objeto.
--
-- O QUE ISTO PRESERVA E O CONSOLIDADO NAO MOSTRA: a evolucao dentro do dia.
-- Exemplo concreto: 20260811154811 (importacao_dedup_fix_rows_from) corrige a
-- 20260811154642, aplicada 1h29 antes, trocando
-- `jsonb_to_recordset(...) with ordinality` por `rows from (...) with
-- ordinality`. O arquivo 0020 ja nasce com a forma correta e nao registra o
-- erro intermediario.
--
-- Extraido por base64 de array_to_string(statements), sem transcricao manual.
-- Fonte: [Claude Code] 2026-09-04.
-- =====================================================================

-- ============================================================
-- version: 20260811154552
-- name:    importacao_dedup_funcoes_e_colunas
-- bytes:   2314
-- ============================================================
create or replace function public.fn_normalizar_descricao(p_descricao text)
returns text language sql immutable strict set search_path = '' as $fn$
  select btrim(
    regexp_replace(
      regexp_replace(
        translate(lower(p_descricao),
          'áàâãäéèêëíìîïóòôõöúùûüçñ',
          'aaaaaeeeeiiiiooooouuuucn'),
        '[^a-z0-9 ]', ' ', 'g'),
      '\s+', ' ', 'g'));
$fn$;

create or replace function public.fn_fingerprint_transacao(
  p_data date, p_centavos bigint, p_descricao text, p_ocorrencia int default 1)
returns text language sql immutable strict set search_path = '' as $fn$
  select encode(sha256(convert_to(
    to_char(p_data, 'YYYY-MM-DD') || '|' || p_centavos::text || '|' ||
    public.fn_normalizar_descricao(p_descricao) || '|' || p_ocorrencia::text,
    'UTF8')), 'hex');
$fn$;

alter table public.transacoes_origem
  add column if not exists id_externo  text,
  add column if not exists fingerprint text;

alter table public.importacao_linhas
  add column if not exists id_externo    text,
  add column if not exists fingerprint   text,
  add column if not exists classificacao text not null default 'NOVO';

do $do$
begin
  if not exists (select 1 from pg_constraint where conname = 'importacao_linhas_classificacao_check') then
    alter table public.importacao_linhas
      add constraint importacao_linhas_classificacao_check
      check (classificacao in ('NOVO','DUPLICADO','AMBIGUO'));
  end if;
end $do$;

create unique index if not exists transacoes_id_externo_uidx
  on public.transacoes_origem (user_id, id_externo)
  where id_externo is not null and deleted_at is null;

create unique index if not exists transacoes_fingerprint_uidx
  on public.transacoes_origem (user_id, fingerprint)
  where fingerprint is not null and deleted_at is null;

create index if not exists transacoes_data_valor_tipo_idx
  on public.transacoes_origem (user_id, data_compra, valor_total, tipo)
  where deleted_at is null;

revoke execute on function public.fn_normalizar_descricao(text) from public, anon;
revoke execute on function public.fn_fingerprint_transacao(date, bigint, text, int) from public, anon;
grant execute on function public.fn_normalizar_descricao(text) to authenticated;
grant execute on function public.fn_fingerprint_transacao(date, bigint, text, int) to authenticated;

-- ============================================================
-- version: 20260811154607
-- name:    importacao_dedup_backfill_fingerprint
-- bytes:   681
-- ============================================================
with numeradas as (
  select
    t.id,
    row_number() over (
      partition by t.user_id, t.data_compra,
                   case when t.tipo = 'DESPESA' then -t.valor_total else t.valor_total end,
                   public.fn_normalizar_descricao(t.descricao)
      order by t.created_at, t.id
    )::int as ocorrencia,
    case when t.tipo = 'DESPESA' then -t.valor_total else t.valor_total end as centavos
  from public.transacoes_origem t
  where t.deleted_at is null and t.fingerprint is null
)
update public.transacoes_origem t
   set fingerprint = public.fn_fingerprint_transacao(t.data_compra, n.centavos, t.descricao, n.ocorrencia)
  from numeradas n
 where n.id = t.id;

-- ============================================================
-- version: 20260811154642
-- name:    importacao_dedup_rpcs
-- bytes:   7038
-- ============================================================
create or replace function public.criar_importacao(p_origem text, p_linhas jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare
  v_user_id uuid := auth.uid();
  v_id uuid; v_total int; v_gravadas int; v_novo int; v_dup int; v_amb int;
begin
  if v_user_id is null then
    raise exception 'Não autenticado.' using errcode='FW401',
      hint='Sessão ausente/expirada. Não retente; reautentique.';
  end if;
  if p_origem not in ('CSV','OFX','OFC','XLSX','PDF','PLUGGY') then
    raise exception 'origem inválida: %', p_origem using errcode='FW400',
      hint='Use CSV, OFX, OFC, XLSX, PDF ou PLUGGY.';
  end if;
  if p_linhas is null or jsonb_typeof(p_linhas) <> 'array' then
    raise exception 'p_linhas deve ser um array JSON.' using errcode='FW400',
      hint='Envie [{data, valor, descricao, id_externo?}, ...].';
  end if;
  v_total := jsonb_array_length(p_linhas);
  if v_total < 1 or v_total > 1000 then
    raise exception 'Importação com % linhas (mínimo 1, máximo 1000).', v_total
      using errcode='FW429', hint='Divida o arquivo em lotes de até 1000 linhas.';
  end if;
  if exists (select 1 from jsonb_array_elements(p_linhas) e
             where jsonb_typeof(e->'valor')='number' and (e->>'valor') ~ '[.,]') then
    raise exception 'Campo valor deve ser inteiro em centavos.' using errcode='FW400',
      hint='Converta reais para centavos na borda (R$ 42,00 -> 4200). Não envie fração.';
  end if;

  insert into public.importacoes (user_id, origem) values (v_user_id, p_origem)
  returning id into v_id;

  with validas as (
    select l.ord, l.data, l.valor, trim(l.descricao) as descricao,
           nullif(trim(coalesce(l.id_externo,'')),'') as id_externo
    from jsonb_to_recordset(p_linhas)
      with ordinality as l(data date, valor bigint, descricao text, id_externo text, ord bigint)
    where l.data is not null and l.valor is not null and l.valor <> 0
      and coalesce(trim(l.descricao),'') <> ''
      and l.data between date '2000-01-01'
          and (now() at time zone 'America/Sao_Paulo')::date + 1
  ),
  ordenadas as (
    select v.*,
      row_number() over (partition by v.data, v.valor,
        public.fn_normalizar_descricao(v.descricao) order by v.ord)::int as ocorrencia,
      case when v.id_externo is null then 1
           else row_number() over (partition by v.id_externo order by v.ord)::int end as ocorrencia_id_ext
    from validas v
  ),
  comfp as (
    select o.*, public.fn_fingerprint_transacao(o.data, o.valor, o.descricao, o.ocorrencia) as fp
    from ordenadas o
  ),
  classificadas as (
    select c.*,
      case
        when c.ocorrencia_id_ext > 1 then 'DUPLICADO'
        when c.id_externo is not null and exists (
          select 1 from public.transacoes_origem t
          where t.user_id=v_user_id and t.deleted_at is null and t.id_externo=c.id_externo) then 'DUPLICADO'
        when exists (
          select 1 from public.transacoes_origem t
          where t.user_id=v_user_id and t.deleted_at is null and t.fingerprint=c.fp) then 'DUPLICADO'
        when exists (
          select 1 from public.transacoes_origem t
          where t.user_id=v_user_id and t.deleted_at is null
            and t.data_compra=c.data and t.valor_total=abs(c.valor)
            and t.tipo = case when c.valor < 0 then 'DESPESA' else 'RECEITA' end) then 'AMBIGUO'
        else 'NOVO'
      end as classificacao
    from comfp c
  )
  insert into public.importacao_linhas
    (importacao_id, user_id, data, valor, descricao, categoria_sugerida,
     id_externo, fingerprint, classificacao, duplicada, ignorar)
  select v_id, v_user_id, k.data, k.valor, k.descricao,
    case when k.valor < 0 then public.fn_sugerir_categoria(v_user_id, k.descricao) end,
    k.id_externo, k.fp, k.classificacao,
    k.classificacao='DUPLICADO', k.classificacao <> 'NOVO'
  from classificadas k;

  get diagnostics v_gravadas = row_count;
  if v_gravadas <> v_total then
    raise exception 'Lote rejeitado: % de % linhas válidas.', v_gravadas, v_total
      using errcode='FW400',
      hint='Toda linha precisa de data plausível (2000-01-01..amanhã), valor <> 0 em centavos e descrição.';
  end if;

  select count(*) filter (where classificacao='NOVO'),
         count(*) filter (where classificacao='DUPLICADO'),
         count(*) filter (where classificacao='AMBIGUO')
    into v_novo, v_dup, v_amb
  from public.importacao_linhas where importacao_id = v_id;

  return jsonb_build_object('importacao_id', v_id, 'linhas', v_total,
    'novos', v_novo, 'duplicadas', v_dup, 'ambiguos', v_amb);
end;
$fn$;

create or replace function public.confirmar_importacao(p_importacao_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare
  v_user_id uuid := auth.uid();
  v_imp public.importacoes%rowtype;
  v_criadas int;
begin
  if v_user_id is null then
    raise exception 'Não autenticado.' using errcode='FW401',
      hint='Sessão ausente/expirada. Não retente; reautentique.';
  end if;
  select * into v_imp from public.importacoes
  where id=p_importacao_id and user_id=v_user_id and deleted_at is null for update;
  if not found then
    raise exception 'Importação % não encontrada para este usuário.', p_importacao_id
      using errcode='FW404', hint='Confira o id da importação.';
  end if;
  if v_imp.status <> 'REVISAO' then
    raise exception 'Importação % já está %.', p_importacao_id, v_imp.status
      using errcode='FW409',
      hint='Commit é único por importação — as transações já foram criadas (ou o lote foi descartado). Não retente.';
  end if;

  with alvo as (
    select data, abs(valor) as valor_abs,
           case when valor < 0 then 'DESPESA' else 'RECEITA' end as tipo,
           descricao, categoria_sugerida, id_externo, fingerprint
    from public.importacao_linhas
    where importacao_id=v_imp.id and user_id=v_user_id and deleted_at is null
      and not ignorar and classificacao <> 'DUPLICADO'
  ),
  novas as (
    insert into public.transacoes_origem
      (user_id, descricao, valor_total, tipo, forma_pagamento, cartao_id,
       data_compra, num_parcelas, categoria_id, id_externo, fingerprint)
    select v_user_id, a.descricao, a.valor_abs, a.tipo, 'DEBITO', null,
           a.data, 1, a.categoria_sugerida, a.id_externo, a.fingerprint
    from alvo a
    returning id, valor_total, data_compra
  )
  insert into public.parcelas (user_id, transacao_id, fatura_id, numero, valor, data_competencia)
  select v_user_id, n.id, null, 1, n.valor_total, n.data_compra from novas n;
  get diagnostics v_criadas = row_count;

  update public.importacoes set status='CONFIRMADA' where id=v_imp.id;
  return jsonb_build_object('importacao_id', v_imp.id, 'transacoes_criadas', v_criadas);
exception
  when unique_violation then
    raise exception 'Importação % colidiu com transação já existente.', p_importacao_id
      using errcode='FW409',
      hint='Alguma linha já foi gravada por outra importação. Descarte este lote e reimporte o arquivo para reclassificar.';
end;
$fn$;

-- ============================================================
-- version: 20260811154811
-- name:    importacao_dedup_fix_rows_from
-- bytes:   4661
-- ============================================================
create or replace function public.criar_importacao(p_origem text, p_linhas jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare
  v_user_id uuid := auth.uid();
  v_id uuid; v_total int; v_gravadas int; v_novo int; v_dup int; v_amb int;
begin
  if v_user_id is null then
    raise exception 'Não autenticado.' using errcode='FW401',
      hint='Sessão ausente/expirada. Não retente; reautentique.';
  end if;
  if p_origem not in ('CSV','OFX','OFC','XLSX','PDF','PLUGGY') then
    raise exception 'origem inválida: %', p_origem using errcode='FW400',
      hint='Use CSV, OFX, OFC, XLSX, PDF ou PLUGGY.';
  end if;
  if p_linhas is null or jsonb_typeof(p_linhas) <> 'array' then
    raise exception 'p_linhas deve ser um array JSON.' using errcode='FW400',
      hint='Envie [{data, valor, descricao, id_externo?}, ...].';
  end if;
  v_total := jsonb_array_length(p_linhas);
  if v_total < 1 or v_total > 1000 then
    raise exception 'Importação com % linhas (mínimo 1, máximo 1000).', v_total
      using errcode='FW429', hint='Divida o arquivo em lotes de até 1000 linhas.';
  end if;
  if exists (select 1 from jsonb_array_elements(p_linhas) e
             where jsonb_typeof(e->'valor')='number' and (e->>'valor') ~ '[.,]') then
    raise exception 'Campo valor deve ser inteiro em centavos.' using errcode='FW400',
      hint='Converta reais para centavos na borda (R$ 42,00 -> 4200). Não envie fração.';
  end if;

  insert into public.importacoes (user_id, origem) values (v_user_id, p_origem)
  returning id into v_id;

  with validas as (
    select l.ord, l.data, l.valor, trim(l.descricao) as descricao,
           nullif(trim(coalesce(l.id_externo,'')),'') as id_externo
    from rows from (
           jsonb_to_recordset(p_linhas)
             as (data date, valor bigint, descricao text, id_externo text)
         ) with ordinality as l(data, valor, descricao, id_externo, ord)
    where l.data is not null and l.valor is not null and l.valor <> 0
      and coalesce(trim(l.descricao),'') <> ''
      and l.data between date '2000-01-01'
          and (now() at time zone 'America/Sao_Paulo')::date + 1
  ),
  ordenadas as (
    select v.*,
      row_number() over (partition by v.data, v.valor,
        public.fn_normalizar_descricao(v.descricao) order by v.ord)::int as ocorrencia,
      case when v.id_externo is null then 1
           else row_number() over (partition by v.id_externo order by v.ord)::int end as ocorrencia_id_ext
    from validas v
  ),
  comfp as (
    select o.*, public.fn_fingerprint_transacao(o.data, o.valor, o.descricao, o.ocorrencia) as fp
    from ordenadas o
  ),
  classificadas as (
    select c.*,
      case
        when c.ocorrencia_id_ext > 1 then 'DUPLICADO'
        when c.id_externo is not null and exists (
          select 1 from public.transacoes_origem t
          where t.user_id=v_user_id and t.deleted_at is null and t.id_externo=c.id_externo) then 'DUPLICADO'
        when exists (
          select 1 from public.transacoes_origem t
          where t.user_id=v_user_id and t.deleted_at is null and t.fingerprint=c.fp) then 'DUPLICADO'
        when exists (
          select 1 from public.transacoes_origem t
          where t.user_id=v_user_id and t.deleted_at is null
            and t.data_compra=c.data and t.valor_total=abs(c.valor)
            and t.tipo = case when c.valor < 0 then 'DESPESA' else 'RECEITA' end) then 'AMBIGUO'
        else 'NOVO'
      end as classificacao
    from comfp c
  )
  insert into public.importacao_linhas
    (importacao_id, user_id, data, valor, descricao, categoria_sugerida,
     id_externo, fingerprint, classificacao, duplicada, ignorar)
  select v_id, v_user_id, k.data, k.valor, k.descricao,
    case when k.valor < 0 then public.fn_sugerir_categoria(v_user_id, k.descricao) end,
    k.id_externo, k.fp, k.classificacao,
    k.classificacao='DUPLICADO', k.classificacao <> 'NOVO'
  from classificadas k;

  get diagnostics v_gravadas = row_count;
  if v_gravadas <> v_total then
    raise exception 'Lote rejeitado: % de % linhas válidas.', v_gravadas, v_total
      using errcode='FW400',
      hint='Toda linha precisa de data plausível (2000-01-01..amanhã), valor <> 0 em centavos e descrição.';
  end if;

  select count(*) filter (where classificacao='NOVO'),
         count(*) filter (where classificacao='DUPLICADO'),
         count(*) filter (where classificacao='AMBIGUO')
    into v_novo, v_dup, v_amb
  from public.importacao_linhas where importacao_id = v_id;

  return jsonb_build_object('importacao_id', v_id, 'linhas', v_total,
    'novos', v_novo, 'duplicadas', v_dup, 'ambiguos', v_amb);
end;
$fn$;

-- ============================================================
-- version: 20260811171442
-- name:    importacao_revisao_source_sha_schema
-- bytes:   1762
-- ============================================================
alter table public.transacoes_origem add column if not exists source text;
alter table public.transacoes_origem alter column source set default 'MANUAL';

do $do$
begin
  if not exists (select 1 from pg_constraint where conname = 'transacoes_source_check') then
    alter table public.transacoes_origem add constraint transacoes_source_check
      check (source is null or source in ('CSV','OFX','OFC','XLSX','PDF','PLUGGY','MANUAL'));
  end if;
end $do$;

alter table public.importacoes add column if not exists arquivo_sha256 text;

do $do$
begin
  if not exists (select 1 from pg_constraint where conname = 'importacoes_sha256_formato_check') then
    alter table public.importacoes add constraint importacoes_sha256_formato_check
      check (arquivo_sha256 is null or arquivo_sha256 ~ '^[0-9a-f]{64}$');
  end if;
end $do$;

create unique index if not exists importacoes_arquivo_sha256_uidx
  on public.importacoes (user_id, arquivo_sha256)
  where arquivo_sha256 is not null and deleted_at is null
    and status in ('REVISAO','CONFIRMADA');

create index if not exists import_linhas_id_externo_idx
  on public.importacao_linhas (user_id, id_externo)
  where id_externo is not null and deleted_at is null;

create index if not exists import_linhas_fingerprint_idx
  on public.importacao_linhas (user_id, fingerprint)
  where fingerprint is not null and deleted_at is null;

comment on column public.transacoes_origem.source is
  'Proveniência da linha. NULL = histórico anterior à 0021 (desconhecida). MANUAL = default de escrita direta. Demais = origem da importação.';
comment on column public.importacoes.arquivo_sha256 is
  'sha256 do arquivo cru, calculado na borda. Reenvio idêntico faz criar_importacao voltar cedo com arquivo_ja_importado = true.';

-- ============================================================
-- version: 20260811171526
-- name:    importacao_revisao_source_sha_rpcs
-- bytes:   9463
-- ============================================================
drop function if exists public.criar_importacao(text, jsonb);

create or replace function public.criar_importacao(
  p_origem text, p_linhas jsonb, p_arquivo_sha256 text default null)
returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare
  v_user_id uuid := auth.uid();
  v_id uuid; v_total int; v_gravadas int; v_novo int; v_dup int; v_amb int;
  v_previa public.importacoes%rowtype;
begin
  if v_user_id is null then
    raise exception 'Não autenticado.' using errcode='FW401',
      hint='Sessão ausente/expirada. Não retente; reautentique.';
  end if;
  if p_origem not in ('CSV','OFX','OFC','XLSX','PDF','PLUGGY') then
    raise exception 'origem inválida: %', p_origem using errcode='FW400',
      hint='Use CSV, OFX, OFC, XLSX, PDF ou PLUGGY.';
  end if;
  if p_arquivo_sha256 is not null and p_arquivo_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'arquivo_sha256 fora do formato.' using errcode='FW400',
      hint='Envie sha256 em hex minúsculo de 64 caracteres, ou null.';
  end if;
  if p_linhas is null or jsonb_typeof(p_linhas) <> 'array' then
    raise exception 'p_linhas deve ser um array JSON.' using errcode='FW400',
      hint='Envie [{data, valor, descricao, id_externo?}, ...].';
  end if;
  v_total := jsonb_array_length(p_linhas);
  if v_total < 1 or v_total > 1000 then
    raise exception 'Importação com % linhas (mínimo 1, máximo 1000).', v_total
      using errcode='FW429', hint='Divida o arquivo em lotes de até 1000 linhas.';
  end if;
  if exists (select 1 from jsonb_array_elements(p_linhas) e
             where jsonb_typeof(e->'valor')='number' and (e->>'valor') ~ '[.,]') then
    raise exception 'Campo valor deve ser inteiro em centavos.' using errcode='FW400',
      hint='Converta reais para centavos na borda (R$ 42,00 -> 4200). Não envie fração.';
  end if;

  if p_arquivo_sha256 is not null then
    select * into v_previa from public.importacoes
    where user_id=v_user_id and arquivo_sha256=p_arquivo_sha256
      and deleted_at is null and status in ('REVISAO','CONFIRMADA')
    order by created_at desc limit 1;
    if found then
      return jsonb_build_object('importacao_id', v_previa.id,
        'arquivo_ja_importado', true, 'status_anterior', v_previa.status,
        'linhas', v_total, 'novos', 0, 'duplicadas', v_total, 'ambiguos', 0);
    end if;
  end if;

  begin
    insert into public.importacoes (user_id, origem, arquivo_sha256)
    values (v_user_id, p_origem, p_arquivo_sha256) returning id into v_id;
  exception when unique_violation then
    select * into v_previa from public.importacoes
    where user_id=v_user_id and arquivo_sha256=p_arquivo_sha256
      and deleted_at is null and status in ('REVISAO','CONFIRMADA')
    order by created_at desc limit 1;
    return jsonb_build_object('importacao_id', v_previa.id,
      'arquivo_ja_importado', true, 'status_anterior', v_previa.status,
      'linhas', v_total, 'novos', 0, 'duplicadas', v_total, 'ambiguos', 0);
  end;

  with validas as (
    select l.ord, l.data, l.valor, trim(l.descricao) as descricao,
           nullif(trim(coalesce(l.id_externo,'')),'') as id_externo
    from rows from (jsonb_to_recordset(p_linhas)
           as (data date, valor bigint, descricao text, id_externo text)
         ) with ordinality as l(data, valor, descricao, id_externo, ord)
    where l.data is not null and l.valor is not null and l.valor <> 0
      and coalesce(trim(l.descricao),'') <> ''
      and l.data between date '2000-01-01'
          and (now() at time zone 'America/Sao_Paulo')::date + 1
  ),
  ordenadas as (
    select v.*,
      row_number() over (partition by v.data, v.valor,
        public.fn_normalizar_descricao(v.descricao) order by v.ord)::int as ocorrencia,
      case when v.id_externo is null then 1
           else row_number() over (partition by v.id_externo order by v.ord)::int end as ocorrencia_id_ext
    from validas v
  ),
  comfp as (
    select o.*, public.fn_fingerprint_transacao(o.data, o.valor, o.descricao, o.ocorrencia) as fp
    from ordenadas o
  ),
  classificadas as (
    select c.*,
      case
        when c.ocorrencia_id_ext > 1 then 'DUPLICADO'
        when c.id_externo is not null and exists (
          select 1 from public.transacoes_origem t
          where t.user_id=v_user_id and t.deleted_at is null
            and t.id_externo=c.id_externo) then 'DUPLICADO'
        when c.id_externo is not null and exists (
          select 1 from public.importacao_linhas il
          join public.importacoes i on i.id = il.importacao_id
          where i.user_id=v_user_id and i.status='REVISAO'
            and i.deleted_at is null and il.deleted_at is null
            and i.id <> v_id and il.id_externo = c.id_externo) then 'DUPLICADO'
        when exists (
          select 1 from public.transacoes_origem t
          where t.user_id=v_user_id and t.deleted_at is null
            and t.fingerprint=c.fp) then 'DUPLICADO'
        when exists (
          select 1 from public.importacao_linhas il
          join public.importacoes i on i.id = il.importacao_id
          where i.user_id=v_user_id and i.status='REVISAO'
            and i.deleted_at is null and il.deleted_at is null
            and i.id <> v_id and il.fingerprint = c.fp) then 'DUPLICADO'
        when exists (
          select 1 from public.transacoes_origem t
          where t.user_id=v_user_id and t.deleted_at is null
            and t.data_compra=c.data and t.valor_total=abs(c.valor)
            and t.tipo = case when c.valor < 0 then 'DESPESA' else 'RECEITA' end) then 'AMBIGUO'
        else 'NOVO'
      end as classificacao
    from comfp c
  )
  insert into public.importacao_linhas
    (importacao_id, user_id, data, valor, descricao, categoria_sugerida,
     id_externo, fingerprint, classificacao, duplicada, ignorar)
  select v_id, v_user_id, k.data, k.valor, k.descricao,
    case when k.valor < 0 then public.fn_sugerir_categoria(v_user_id, k.descricao) end,
    k.id_externo, k.fp, k.classificacao,
    k.classificacao='DUPLICADO', k.classificacao <> 'NOVO'
  from classificadas k;

  get diagnostics v_gravadas = row_count;
  if v_gravadas <> v_total then
    raise exception 'Lote rejeitado: % de % linhas válidas.', v_gravadas, v_total
      using errcode='FW400',
      hint='Toda linha precisa de data plausível (2000-01-01..amanhã), valor <> 0 em centavos e descrição.';
  end if;

  select count(*) filter (where classificacao='NOVO'),
         count(*) filter (where classificacao='DUPLICADO'),
         count(*) filter (where classificacao='AMBIGUO')
    into v_novo, v_dup, v_amb
  from public.importacao_linhas where importacao_id = v_id;

  return jsonb_build_object('importacao_id', v_id, 'arquivo_ja_importado', false,
    'linhas', v_total, 'novos', v_novo, 'duplicadas', v_dup, 'ambiguos', v_amb);
end;
$fn$;

create or replace function public.confirmar_importacao(p_importacao_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare
  v_user_id uuid := auth.uid();
  v_imp public.importacoes%rowtype;
  v_criadas int;
begin
  if v_user_id is null then
    raise exception 'Não autenticado.' using errcode='FW401',
      hint='Sessão ausente/expirada. Não retente; reautentique.';
  end if;
  select * into v_imp from public.importacoes
  where id=p_importacao_id and user_id=v_user_id and deleted_at is null for update;
  if not found then
    raise exception 'Importação % não encontrada para este usuário.', p_importacao_id
      using errcode='FW404', hint='Confira o id da importação.';
  end if;
  if v_imp.status <> 'REVISAO' then
    raise exception 'Importação % já está %.', p_importacao_id, v_imp.status
      using errcode='FW409',
      hint='Commit é único por importação — as transações já foram criadas (ou o lote foi descartado). Não retente.';
  end if;

  with alvo as (
    select data, abs(valor) as valor_abs,
           case when valor < 0 then 'DESPESA' else 'RECEITA' end as tipo,
           descricao, categoria_sugerida, id_externo, fingerprint
    from public.importacao_linhas
    where importacao_id=v_imp.id and user_id=v_user_id and deleted_at is null
      and not ignorar and classificacao <> 'DUPLICADO'
  ),
  novas as (
    insert into public.transacoes_origem
      (user_id, descricao, valor_total, tipo, forma_pagamento, cartao_id,
       data_compra, num_parcelas, categoria_id, id_externo, fingerprint, source)
    select v_user_id, a.descricao, a.valor_abs, a.tipo, 'DEBITO', null,
           a.data, 1, a.categoria_sugerida, a.id_externo, a.fingerprint, v_imp.origem
    from alvo a returning id, valor_total, data_compra
  )
  insert into public.parcelas (user_id, transacao_id, fatura_id, numero, valor, data_competencia)
  select v_user_id, n.id, null, 1, n.valor_total, n.data_compra from novas n;
  get diagnostics v_criadas = row_count;

  update public.importacoes set status='CONFIRMADA' where id=v_imp.id;
  return jsonb_build_object('importacao_id', v_imp.id, 'transacoes_criadas', v_criadas);
exception
  when unique_violation then
    raise exception 'Importação % colidiu com transação já existente.', p_importacao_id
      using errcode='FW409',
      hint='Alguma linha já foi gravada por outra importação. Descarte este lote e reimporte o arquivo para reclassificar.';
end;
$fn$;

revoke execute on function public.criar_importacao(text, jsonb, text) from public, anon;
grant execute on function public.criar_importacao(text, jsonb, text) to authenticated;

-- ============================================================
-- version: 20260811174345
-- name:    security_hardening_grants_e_search_path
-- bytes:   2099
-- ============================================================
revoke truncate, references, trigger on all tables in schema public from anon, authenticated;

do $do$
begin
  execute 'revoke maintain on all tables in schema public from anon, authenticated';
exception when syntax_error or feature_not_supported then
  raise notice '0022: MAINTAIN nao suportado nesta versao - ignorado.';
end $do$;

revoke insert, update, delete
  on public.vw_carteira, public.vw_contas_a_pagar, public.vw_faturas_consolidadas
  from anon, authenticated;

alter default privileges in schema public
  revoke truncate, references, trigger on tables from anon, authenticated;

do $do$
begin
  execute 'alter default privileges in schema public revoke maintain on tables from anon, authenticated';
exception when syntax_error or feature_not_supported then
  raise notice '0022: MAINTAIN em default privileges nao suportado - ignorado.';
end $do$;

create or replace function public.fn_touch_updated_at()
returns trigger language plpgsql set search_path = '' as $fn$
begin
  -- clock_timestamp(), nao now(): now() congela no inicio da transacao e
  -- deixaria updated_at indistinguivel de created_at em fluxos batch/teste.
  new.updated_at := pg_catalog.clock_timestamp();
  return new;
end;
$fn$;

revoke execute on function public.rls_auto_enable() from public, anon, authenticated;

do $do$
declare v_restante int; v_detalhe text;
begin
  select count(*), coalesce(string_agg(distinct grantee || ':' || privilege_type, ', '), '')
    into v_restante, v_detalhe
  from information_schema.role_table_grants
  where table_schema='public' and grantee in ('anon','authenticated')
    and privilege_type in ('TRUNCATE','REFERENCES','TRIGGER');
  if v_restante > 0 then
    raise exception '0022: sobraram % grants perigosos: %', v_restante, v_detalhe;
  end if;
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
             where n.nspname='public' and p.proname='fn_touch_updated_at' and p.proconfig is null) then
    raise exception '0022: fn_touch_updated_at continua sem search_path fixo.';
  end if;
  raise notice '0022: verificacao OK.';
end $do$;

-- ============================================================
-- version: 20260811211505
-- name:    conciliacao_fatura_extrato_schema
-- bytes:   3692
-- ============================================================
alter table public.transacoes_origem
  add column if not exists natureza text not null default 'CONSUMO',
  add column if not exists fatura_liquidada_id uuid references public.faturas (id);

do $do$
begin
  if not exists (select 1 from pg_constraint where conname='transacoes_natureza_check') then
    alter table public.transacoes_origem add constraint transacoes_natureza_check
      check (natureza in ('CONSUMO','LIQUIDACAO_FATURA'));
  end if;
  if not exists (select 1 from pg_constraint where conname='transacoes_liquidacao_nao_credito_check') then
    alter table public.transacoes_origem add constraint transacoes_liquidacao_nao_credito_check
      check (natureza <> 'LIQUIDACAO_FATURA' or forma_pagamento <> 'CREDITO');
  end if;
  if not exists (select 1 from pg_constraint where conname='transacoes_fatura_liquidada_coerente_check') then
    alter table public.transacoes_origem add constraint transacoes_fatura_liquidada_coerente_check
      check (fatura_liquidada_id is null or natureza = 'LIQUIDACAO_FATURA');
  end if;
end $do$;

alter table public.importacao_linhas
  add column if not exists natureza_detectada text not null default 'CONSUMO',
  add column if not exists fatura_liquidada_id uuid references public.faturas (id),
  add column if not exists liquidacao_sugerida boolean not null default false;

do $do$
begin
  if not exists (select 1 from pg_constraint where conname='import_linhas_natureza_check') then
    alter table public.importacao_linhas add constraint import_linhas_natureza_check
      check (natureza_detectada in ('CONSUMO','LIQUIDACAO_FATURA'));
  end if;
end $do$;

create or replace function public.fn_parece_pagamento_fatura(p_descricao text)
returns boolean language sql immutable strict set search_path = '' as $fn$
  select public.fn_normalizar_descricao(p_descricao) ~
    '(^| )(pagamento|pgto|pagto|pag)( de)? (fatura|cartao de credito)( |$)|(^| )fatura (do )?cartao( |$)|(^| )pagamento cartao( |$)';
$fn$;

create or replace function public.fn_fatura_liquidada_por(
  p_user_id uuid, p_data date, p_centavos bigint)
returns uuid language sql stable set search_path = '' as $fn$
  with candidatas as (
    select v.id, abs(v.data_vencimento - p_data) as distancia
    from public.vw_faturas_consolidadas v
    where v.user_id = p_user_id
      and p_centavos < 0
      and v.valor_total_fatura = abs(p_centavos)
      and v.data_vencimento between p_data - 5 and p_data + 5
  )
  select case when (select count(*) from candidatas) = 1
              then (select id from candidatas)
         when (select count(*) from candidatas c
               where c.distancia = (select min(distancia) from candidatas)) = 1
              then (select id from candidatas order by distancia limit 1)
         else null end;
$fn$;

create index if not exists transacoes_natureza_idx
  on public.transacoes_origem (user_id, natureza)
  where deleted_at is null and natureza <> 'CONSUMO';

revoke execute on function public.fn_parece_pagamento_fatura(text) from public, anon;
revoke execute on function public.fn_fatura_liquidada_por(uuid, date, bigint) from public, anon;
grant execute on function public.fn_parece_pagamento_fatura(text) to authenticated;
grant execute on function public.fn_fatura_liquidada_por(uuid, date, bigint) to authenticated;

comment on column public.transacoes_origem.natureza is
  'CONSUMO = despesa/receita real, soma nos relatorios. LIQUIDACAO_FATURA = pagamento de fatura: saida de caixa que quita consumo JA contado nas parcelas.';
comment on column public.importacao_linhas.liquidacao_sugerida is
  'Descricao parece pagamento de fatura mas nenhuma fatura casou por valor exato. Linha grava como CONSUMO; a UI pergunta.';

-- ============================================================
-- version: 20260811211601
-- name:    conciliacao_fatura_extrato_rpcs_e_view
-- bytes:   12007
-- ============================================================
create or replace function public.criar_importacao(
  p_origem text, p_linhas jsonb, p_arquivo_sha256 text default null)
returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare
  v_user_id uuid := auth.uid();
  v_id uuid; v_total int; v_gravadas int; v_novo int; v_dup int; v_amb int; v_liq int;
  v_previa public.importacoes%rowtype;
begin
  if v_user_id is null then
    raise exception 'Não autenticado.' using errcode='FW401',
      hint='Sessão ausente/expirada. Não retente; reautentique.';
  end if;
  if p_origem not in ('CSV','OFX','OFC','XLSX','PDF','PLUGGY') then
    raise exception 'origem inválida: %', p_origem using errcode='FW400',
      hint='Use CSV, OFX, OFC, XLSX, PDF ou PLUGGY.';
  end if;
  if p_arquivo_sha256 is not null and p_arquivo_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'arquivo_sha256 fora do formato.' using errcode='FW400',
      hint='Envie sha256 em hex minúsculo de 64 caracteres, ou null.';
  end if;
  if p_linhas is null or jsonb_typeof(p_linhas) <> 'array' then
    raise exception 'p_linhas deve ser um array JSON.' using errcode='FW400',
      hint='Envie [{data, valor, descricao, id_externo?}, ...].';
  end if;
  v_total := jsonb_array_length(p_linhas);
  if v_total < 1 or v_total > 1000 then
    raise exception 'Importação com % linhas (mínimo 1, máximo 1000).', v_total
      using errcode='FW429', hint='Divida o arquivo em lotes de até 1000 linhas.';
  end if;
  if exists (select 1 from jsonb_array_elements(p_linhas) e
             where jsonb_typeof(e->'valor')='number' and (e->>'valor') ~ '[.,]') then
    raise exception 'Campo valor deve ser inteiro em centavos.' using errcode='FW400',
      hint='Converta reais para centavos na borda (R$ 42,00 -> 4200). Não envie fração.';
  end if;

  if p_arquivo_sha256 is not null then
    select * into v_previa from public.importacoes
    where user_id=v_user_id and arquivo_sha256=p_arquivo_sha256
      and deleted_at is null and status in ('REVISAO','CONFIRMADA')
    order by created_at desc limit 1;
    if found then
      return jsonb_build_object('importacao_id', v_previa.id,
        'arquivo_ja_importado', true, 'status_anterior', v_previa.status,
        'linhas', v_total, 'novos', 0, 'duplicadas', v_total, 'ambiguos', 0, 'liquidacoes', 0);
    end if;
  end if;

  begin
    insert into public.importacoes (user_id, origem, arquivo_sha256)
    values (v_user_id, p_origem, p_arquivo_sha256) returning id into v_id;
  exception when unique_violation then
    select * into v_previa from public.importacoes
    where user_id=v_user_id and arquivo_sha256=p_arquivo_sha256
      and deleted_at is null and status in ('REVISAO','CONFIRMADA')
    order by created_at desc limit 1;
    return jsonb_build_object('importacao_id', v_previa.id,
      'arquivo_ja_importado', true, 'status_anterior', v_previa.status,
      'linhas', v_total, 'novos', 0, 'duplicadas', v_total, 'ambiguos', 0, 'liquidacoes', 0);
  end;

  with validas as (
    select l.ord, l.data, l.valor, trim(l.descricao) as descricao,
           nullif(trim(coalesce(l.id_externo,'')),'') as id_externo
    from rows from (jsonb_to_recordset(p_linhas)
           as (data date, valor bigint, descricao text, id_externo text)
         ) with ordinality as l(data, valor, descricao, id_externo, ord)
    where l.data is not null and l.valor is not null and l.valor <> 0
      and coalesce(trim(l.descricao),'') <> ''
      and l.data between date '2000-01-01'
          and (now() at time zone 'America/Sao_Paulo')::date + 1
  ),
  ordenadas as (
    select v.*,
      row_number() over (partition by v.data, v.valor,
        public.fn_normalizar_descricao(v.descricao) order by v.ord)::int as ocorrencia,
      case when v.id_externo is null then 1
           else row_number() over (partition by v.id_externo order by v.ord)::int end as ocorrencia_id_ext
    from validas v
  ),
  comfp as (
    select o.*, public.fn_fingerprint_transacao(o.data, o.valor, o.descricao, o.ocorrencia) as fp
    from ordenadas o
  ),
  classificadas as (
    select c.*,
      case
        when c.ocorrencia_id_ext > 1 then 'DUPLICADO'
        when c.id_externo is not null and exists (
          select 1 from public.transacoes_origem t
          where t.user_id=v_user_id and t.deleted_at is null and t.id_externo=c.id_externo) then 'DUPLICADO'
        when c.id_externo is not null and exists (
          select 1 from public.importacao_linhas il
          join public.importacoes i on i.id = il.importacao_id
          where i.user_id=v_user_id and i.status='REVISAO'
            and i.deleted_at is null and il.deleted_at is null
            and i.id <> v_id and il.id_externo = c.id_externo) then 'DUPLICADO'
        when exists (
          select 1 from public.transacoes_origem t
          where t.user_id=v_user_id and t.deleted_at is null and t.fingerprint=c.fp) then 'DUPLICADO'
        when exists (
          select 1 from public.importacao_linhas il
          join public.importacoes i on i.id = il.importacao_id
          where i.user_id=v_user_id and i.status='REVISAO'
            and i.deleted_at is null and il.deleted_at is null
            and i.id <> v_id and il.fingerprint = c.fp) then 'DUPLICADO'
        when exists (
          select 1 from public.transacoes_origem t
          where t.user_id=v_user_id and t.deleted_at is null
            and t.data_compra=c.data and t.valor_total=abs(c.valor)
            and t.tipo = case when c.valor < 0 then 'DESPESA' else 'RECEITA' end) then 'AMBIGUO'
        else 'NOVO'
      end as classificacao,
      public.fn_parece_pagamento_fatura(c.descricao) as parece_liq,
      case when public.fn_parece_pagamento_fatura(c.descricao)
           then public.fn_fatura_liquidada_por(v_user_id, c.data, c.valor) end as fatura_id
    from comfp c
  )
  insert into public.importacao_linhas
    (importacao_id, user_id, data, valor, descricao, categoria_sugerida,
     id_externo, fingerprint, classificacao, duplicada, ignorar,
     natureza_detectada, fatura_liquidada_id, liquidacao_sugerida)
  select v_id, v_user_id, k.data, k.valor, k.descricao,
    case when k.valor < 0 and k.fatura_id is null
         then public.fn_sugerir_categoria(v_user_id, k.descricao) end,
    k.id_externo, k.fp, k.classificacao,
    k.classificacao='DUPLICADO', k.classificacao <> 'NOVO',
    case when k.fatura_id is not null then 'LIQUIDACAO_FATURA' else 'CONSUMO' end,
    k.fatura_id,
    (k.parece_liq and k.fatura_id is null)
  from classificadas k;

  get diagnostics v_gravadas = row_count;
  if v_gravadas <> v_total then
    raise exception 'Lote rejeitado: % de % linhas válidas.', v_gravadas, v_total
      using errcode='FW400',
      hint='Toda linha precisa de data plausível (2000-01-01..amanhã), valor <> 0 em centavos e descrição.';
  end if;

  select count(*) filter (where classificacao='NOVO'),
         count(*) filter (where classificacao='DUPLICADO'),
         count(*) filter (where classificacao='AMBIGUO'),
         count(*) filter (where natureza_detectada='LIQUIDACAO_FATURA')
    into v_novo, v_dup, v_amb, v_liq
  from public.importacao_linhas where importacao_id = v_id;

  return jsonb_build_object('importacao_id', v_id, 'arquivo_ja_importado', false,
    'linhas', v_total, 'novos', v_novo, 'duplicadas', v_dup,
    'ambiguos', v_amb, 'liquidacoes', v_liq);
end;
$fn$;

create or replace function public.confirmar_importacao(p_importacao_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare
  v_user_id uuid := auth.uid();
  v_imp public.importacoes%rowtype;
  v_criadas int;
begin
  if v_user_id is null then
    raise exception 'Não autenticado.' using errcode='FW401',
      hint='Sessão ausente/expirada. Não retente; reautentique.';
  end if;
  select * into v_imp from public.importacoes
  where id=p_importacao_id and user_id=v_user_id and deleted_at is null for update;
  if not found then
    raise exception 'Importação % não encontrada para este usuário.', p_importacao_id
      using errcode='FW404', hint='Confira o id da importação.';
  end if;
  if v_imp.status <> 'REVISAO' then
    raise exception 'Importação % já está %.', p_importacao_id, v_imp.status
      using errcode='FW409',
      hint='Commit é único por importação — as transações já foram criadas (ou o lote foi descartado). Não retente.';
  end if;

  with alvo as (
    select data, abs(valor) as valor_abs,
           case when valor < 0 then 'DESPESA' else 'RECEITA' end as tipo,
           descricao, categoria_sugerida, id_externo, fingerprint,
           natureza_detectada, fatura_liquidada_id
    from public.importacao_linhas
    where importacao_id=v_imp.id and user_id=v_user_id and deleted_at is null
      and not ignorar and classificacao <> 'DUPLICADO'
  ),
  novas as (
    insert into public.transacoes_origem
      (user_id, descricao, valor_total, tipo, forma_pagamento, cartao_id,
       data_compra, num_parcelas, categoria_id, id_externo, fingerprint, source,
       natureza, fatura_liquidada_id)
    select v_user_id, a.descricao, a.valor_abs, a.tipo, 'DEBITO', null,
           a.data, 1, a.categoria_sugerida, a.id_externo, a.fingerprint, v_imp.origem,
           a.natureza_detectada, a.fatura_liquidada_id
    from alvo a returning id, valor_total, data_compra
  )
  insert into public.parcelas (user_id, transacao_id, fatura_id, numero, valor, data_competencia)
  select v_user_id, n.id, null, 1, n.valor_total, n.data_compra from novas n;
  get diagnostics v_criadas = row_count;

  update public.importacoes set status='CONFIRMADA' where id=v_imp.id;
  return jsonb_build_object('importacao_id', v_imp.id, 'transacoes_criadas', v_criadas);
exception
  when unique_violation then
    raise exception 'Importação % colidiu com transação já existente.', p_importacao_id
      using errcode='FW409',
      hint='Alguma linha já foi gravada por outra importação. Descarte este lote e reimporte o arquivo para reclassificar.';
end;
$fn$;

create or replace view public.vw_carteira
with (security_invoker = true) as
select
  coalesce((select sum(t.valor_total) from public.transacoes_origem t
            where t.tipo='RECEITA' and t.deleted_at is null), 0)::bigint as entradas,
  coalesce((select sum(t.valor_total) from public.transacoes_origem t
            where t.tipo='DESPESA'
              and t.forma_pagamento = any (array['DEBITO','PIX','DINHEIRO'])
              and t.natureza = 'CONSUMO'
              and t.deleted_at is null), 0)::bigint as saidas_avista,
  coalesce((select sum(v.valor_total_fatura) from public.vw_faturas_consolidadas v
            where v.status='PAGA'), 0)::bigint as faturas_pagas,
  (
    coalesce((select sum(t.valor_total) from public.transacoes_origem t
              where t.tipo='RECEITA' and t.deleted_at is null), 0)
    - coalesce((select sum(t.valor_total) from public.transacoes_origem t
                where t.tipo='DESPESA'
                  and t.forma_pagamento = any (array['DEBITO','PIX','DINHEIRO'])
                  and t.natureza = 'CONSUMO'
                  and t.deleted_at is null), 0)
    - coalesce((select sum(v.valor_total_fatura) from public.vw_faturas_consolidadas v
                where v.status='PAGA'), 0)
    - coalesce((select sum(t.valor_total)
                from public.transacoes_origem t
                join public.parcelas p on p.transacao_id = t.id and p.deleted_at is null
                where t.forma_pagamento='BOLETO' and t.tipo='DESPESA'
                  and t.deleted_at is null and p.status='PAGA'), 0)
  )::bigint as saldo_caixa,
  coalesce((select sum(t.valor_total)
            from public.transacoes_origem t
            join public.parcelas p on p.transacao_id = t.id and p.deleted_at is null
            where t.forma_pagamento='BOLETO' and t.tipo='DESPESA'
              and t.deleted_at is null and p.status='PAGA'), 0)::bigint as boletos_pagos;

grant select on public.vw_carteira to authenticated;
revoke insert, update, delete on public.vw_carteira from anon, authenticated;

-- ============================================================
-- version: 20260811234924
-- name:    excluir_cofrinho
-- bytes:   2442
-- ============================================================
create or replace function public.excluir_cofrinho(
  p_cofrinho_id uuid, p_resgatar_saldo boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare
  v_user_id uuid := auth.uid();
  v_c public.cofrinhos%rowtype;
  v_data date := (now() at time zone 'America/Sao_Paulo')::date;
  v_movs int;
  v_resgatado bigint := 0;
begin
  if v_user_id is null then
    raise exception 'Não autenticado.'
      using errcode='FW401', hint='Sessão ausente/expirada. Não retente; reautentique.';
  end if;
  if p_cofrinho_id is null then
    raise exception 'p_cofrinho_id é obrigatório.'
      using errcode='FW400', hint='Envie o id do cofrinho.';
  end if;

  select * into v_c from public.cofrinhos
  where id = p_cofrinho_id and user_id = v_user_id and deleted_at is null
  for update;
  if not found then
    raise exception 'Cofrinho % não encontrado para este usuário.', p_cofrinho_id
      using errcode='FW404', hint='Confira o id; o cofrinho pode já estar excluído.';
  end if;

  if v_c.saldo_atual > 0 and not coalesce(p_resgatar_saldo, false) then
    raise exception 'Cofrinho "%" ainda tem % centavos guardados.', v_c.nome, v_c.saldo_atual
      using errcode='FW409',
            hint='Resgate o saldo antes de excluir, ou chame de novo com p_resgatar_saldo = true para resgatar tudo e excluir na mesma operação.';
  end if;

  if v_c.saldo_atual > 0 then
    v_resgatado := v_c.saldo_atual;
    insert into public.movimentacoes_cofrinho (user_id, cofrinho_id, valor, tipo, data)
    values (v_user_id, v_c.id, v_resgatado, 'RESGATE', v_data);
    update public.cofrinhos set saldo_atual = 0 where id = v_c.id;
  end if;

  update public.cofrinhos set deleted_at = now() where id = v_c.id;

  update public.movimentacoes_cofrinho set deleted_at = now()
   where cofrinho_id = v_c.id and user_id = v_user_id and deleted_at is null;
  get diagnostics v_movs = row_count;

  return jsonb_build_object('cofrinho_id', v_c.id, 'nome', v_c.nome,
    'saldo_resgatado', v_resgatado, 'movimentacoes_ocultadas', v_movs);
end;
$fn$;

comment on function public.excluir_cofrinho(uuid, boolean) is
  'Soft-delete de cofrinho. Recusa com FW409 se houver saldo, salvo p_resgatar_saldo = true. Cascata de soft-delete nas movimentacoes.';

revoke execute on function public.excluir_cofrinho(uuid, boolean) from public, anon;
grant execute on function public.excluir_cofrinho(uuid, boolean) to authenticated;
