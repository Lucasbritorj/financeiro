-- =====================================================================
-- 0021_importacao_revisao_source_sha.sql
-- Fecha o GAP F1 da 0020 e traz duas ideias do Nexo que cabem sem mexer
-- em arquitetura: hash do arquivo e proveniência na materialização.
--
-- F1 (o defeito): as três cláusulas EXISTS de criar_importacao consultavam
-- só transacoes_origem. Staging de OUTRAS importações em REVISAO era
-- invisível. Subir o mesmo arquivo duas vezes sem confirmar a primeira
-- devolvia tudo NOVO nas duas; confirmar as duas fazia a segunda bater no
-- unique index e voltar FW409. Integridade nunca esteve em risco — a rede
-- de segurança da 0020 funcionou. O que estava ruim era a UX: erro em vez
-- de "0 novos".
--
-- O QUE MUDA:
--   G1. criar_importacao classifica DUPLICADO também contra importacao_linhas
--       de outras importações REVISAO do mesmo usuário, na MESMA precedência
--       do razão (id_externo, depois fingerprint).
--   G2. importacoes.arquivo_sha256 + short-circuit: reenviar byte-a-byte o
--       mesmo arquivo devolve cedo, sem recriar staging.
--   G3. transacoes_origem.source registra de onde a linha veio.
--
-- NÃO MUDA (proibido — quebraria hash já gravado):
--   fn_normalizar_descricao, fn_fingerprint_transacao, formato do fingerprint,
--   os unique index da 0020.
-- =====================================================================

-- ---------------------------------------------------------------- G3. source
-- Adicionada SEM default para que as linhas já existentes fiquem NULL.
-- NULL aqui significa "não sei de onde veio", que é a verdade: parte do
-- histórico entrou por importação e parte na mão, e não há registro de qual
-- é qual. Marcar tudo como 'MANUAL' seria inventar proveniência.
alter table public.transacoes_origem
  add column if not exists source text;

-- O default entra DEPOIS do add: vale só para linha nova. Assim todos os
-- caminhos de escrita que já existem (processar_transacao_completa 0002,
-- boletos 0013, recorrências 0014, substituir_transacao 0019) passam a
-- gravar 'MANUAL' sem precisar de uma linha de diff em cada um.
alter table public.transacoes_origem
  alter column source set default 'MANUAL';

do $do$
begin
  if not exists (select 1 from pg_constraint where conname = 'transacoes_source_check') then
    alter table public.transacoes_origem
      add constraint transacoes_source_check
      check (source is null or source in ('CSV','OFX','OFC','XLSX','PDF','PLUGGY','MANUAL'));
  end if;
end $do$;

comment on column public.transacoes_origem.source is
  'Proveniência da linha. NULL = histórico anterior à 0021 (desconhecida, não presumir). MANUAL = default de qualquer escrita direta. Demais valores = origem da importação que a materializou.';

-- ---------------------------------------------------------------- G2. sha256 do arquivo
alter table public.importacoes
  add column if not exists arquivo_sha256 text;

do $do$
begin
  if not exists (select 1 from pg_constraint where conname = 'importacoes_sha256_formato_check') then
    alter table public.importacoes
      add constraint importacoes_sha256_formato_check
      check (arquivo_sha256 is null or arquivo_sha256 ~ '^[0-9a-f]{64}$');
  end if;
end $do$;

-- DESCARTADA fica FORA do índice de propósito: descartar é o usuário dizendo
-- "esse lote não presta". Ele precisa conseguir subir o mesmo arquivo de novo
-- (ex.: escolheu o preset de banco errado no CSV e quer refazer).
create unique index if not exists importacoes_arquivo_sha256_uidx
  on public.importacoes (user_id, arquivo_sha256)
  where arquivo_sha256 is not null
    and deleted_at is null
    and status in ('REVISAO','CONFIRMADA');

comment on column public.importacoes.arquivo_sha256 is
  'sha256 do arquivo cru, calculado na borda. Reenvio do mesmo byte-a-byte faz criar_importacao voltar cedo com arquivo_ja_importado = true.';

-- Classificação contra staging REVISAO consulta por (importacao_id, id_externo)
-- e (importacao_id, fingerprint); os índices abaixo cobrem o EXISTS.
create index if not exists import_linhas_id_externo_idx
  on public.importacao_linhas (user_id, id_externo)
  where id_externo is not null and deleted_at is null;

create index if not exists import_linhas_fingerprint_idx
  on public.importacao_linhas (user_id, fingerprint)
  where fingerprint is not null and deleted_at is null;

-- ---------------------------------------------------------------- G1+G2. criar_importacao
-- A assinatura ganha p_arquivo_sha256. A versão de 2 argumentos precisa ser
-- DERRUBADA: com as duas no catálogo, uma chamada com 2 args fica ambígua e
-- o Postgres recusa. Drop antes do create, não depois.
drop function if exists public.criar_importacao(text, jsonb);

create or replace function public.criar_importacao(
  p_origem         text,
  p_linhas         jsonb,
  p_arquivo_sha256 text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_user_id  uuid := auth.uid();
  v_id       uuid;
  v_total    int;
  v_gravadas int;
  v_novo     int;
  v_dup      int;
  v_amb      int;
  v_previa   public.importacoes%rowtype;
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

  -- ---- G2: short-circuit de arquivo idêntico (OPÇÃO A) ----
  -- Volta cedo, sem criar importação nem staging. Recriar 300 linhas só para
  -- marcá-las todas DUPLICADO (opção B) gastaria escrita e deixaria lixo em
  -- REVISAO para o usuário descartar na mão.
  if p_arquivo_sha256 is not null then
    select * into v_previa
    from public.importacoes
    where user_id = v_user_id
      and arquivo_sha256 = p_arquivo_sha256
      and deleted_at is null
      and status in ('REVISAO','CONFIRMADA')
    order by created_at desc
    limit 1;
    if found then
      return jsonb_build_object(
        'importacao_id',         v_previa.id,
        'arquivo_ja_importado',  true,
        'status_anterior',       v_previa.status,
        'linhas',                v_total,
        'novos',                 0,
        'duplicadas',            v_total,
        'ambiguos',              0);
    end if;
  end if;

  begin
    insert into public.importacoes (user_id, origem, arquivo_sha256)
    values (v_user_id, p_origem, p_arquivo_sha256)
    returning id into v_id;
  exception when unique_violation then
    -- Corrida: dois uploads do mesmo arquivo em paralelo passaram os dois
    -- pelo SELECT acima. O índice barrou o segundo; devolvemos a mesma
    -- resposta do short-circuit em vez de um erro cru.
    select * into v_previa
    from public.importacoes
    where user_id = v_user_id and arquivo_sha256 = p_arquivo_sha256
      and deleted_at is null and status in ('REVISAO','CONFIRMADA')
    order by created_at desc limit 1;
    return jsonb_build_object(
      'importacao_id', v_previa.id, 'arquivo_ja_importado', true,
      'status_anterior', v_previa.status, 'linhas', v_total,
      'novos', 0, 'duplicadas', v_total, 'ambiguos', 0);
  end;

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
        -- (a) repetição do mesmo id_externo dentro do próprio arquivo
        when c.ocorrencia_id_ext > 1 then 'DUPLICADO'
        -- (b) razão, por id_externo
        when c.id_externo is not null and exists (
          select 1 from public.transacoes_origem t
          where t.user_id=v_user_id and t.deleted_at is null
            and t.id_externo=c.id_externo) then 'DUPLICADO'
        -- (c) G1: staging REVISAO de OUTRA importação, por id_externo.
        --     Mesma precedência do razão: id_externo antes de fingerprint.
        when c.id_externo is not null and exists (
          select 1 from public.importacao_linhas il
          join public.importacoes i on i.id = il.importacao_id
          where i.user_id = v_user_id and i.status = 'REVISAO'
            and i.deleted_at is null and il.deleted_at is null
            and i.id <> v_id
            and il.id_externo = c.id_externo) then 'DUPLICADO'
        -- (d) razão, por fingerprint
        when exists (
          select 1 from public.transacoes_origem t
          where t.user_id=v_user_id and t.deleted_at is null
            and t.fingerprint=c.fp) then 'DUPLICADO'
        -- (e) G1: staging REVISAO de OUTRA importação, por fingerprint
        when exists (
          select 1 from public.importacao_linhas il
          join public.importacoes i on i.id = il.importacao_id
          where i.user_id = v_user_id and i.status = 'REVISAO'
            and i.deleted_at is null and il.deleted_at is null
            and i.id <> v_id
            and il.fingerprint = c.fp) then 'DUPLICADO'
        -- (f) AMBIGUO continua SÓ contra o razão. Staging não é fato
        --     consumado: marcar ambíguo contra algo que o usuário ainda pode
        --     descartar produziria aviso que some sozinho, e o custo de errar
        --     aqui (linha legítima nasce desmarcada) é maior que o benefício.
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

  return jsonb_build_object(
    'importacao_id', v_id, 'arquivo_ja_importado', false,
    'linhas', v_total, 'novos', v_novo, 'duplicadas', v_dup, 'ambiguos', v_amb);
end;
$fn$;

-- ---------------------------------------------------------------- G3. confirmar_importacao
-- Único ponto que precisa gravar source explicitamente; todo o resto do
-- sistema pega o default 'MANUAL'.
create or replace function public.confirmar_importacao(p_importacao_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_user_id uuid := auth.uid();
  v_imp     public.importacoes%rowtype;
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

-- ---------------------------------------------------------------- Privilégios
-- A assinatura de criar_importacao mudou (3 args): os grants da 0009 morreram
-- junto com o drop. Reemitidos no mesmo padrão.
revoke execute on function public.criar_importacao(text, jsonb, text) from public, anon;
grant  execute on function public.criar_importacao(text, jsonb, text) to authenticated;
