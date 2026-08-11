-- =====================================================================
-- 0020_importacao_dedup.sql
-- Deduplicação de importação de extrato, fechando as lacunas da 0009/0016/0018.
--
-- O QUE JÁ EXISTIA: criar_importacao comparava cada linha contra
-- transacoes_origem por (data_compra, valor_total, lower(trim(descricao)))
-- e marcava duplicada = ignorar = true; confirmar_importacao só materializa
-- `not ignorar`. Funcionava, mas:
--   * era best-effort em memória — nenhum índice impedia a gravação duplicada
--     se a checagem passasse (corrida entre dois confirms, ou descrição com
--     espaçamento/acento diferente);
--   * FITID do OFX era descartado pelo parser, então o identificador
--     autoritativo do banco não era usado;
--   * `lower(trim())` não colapsa espaço interno nem acento: "PIX  ENVIADO"
--     e "Pix Enviado" eram consideradas transações diferentes;
--   * duplicada era booleano — não havia como expressar "provavelmente a
--     mesma, confirme você".
--
-- O QUE MUDA AQUI:
--   1. transacoes_origem ganha id_externo (FITID e afins) e fingerprint.
--   2. Dois unique index parciais como REDE DE SEGURANÇA no Postgres: nem
--      corrida nem bug de aplicação consegue gravar a mesma linha duas vezes.
--   3. Fingerprint = sha256(data | centavos COM SINAL | descrição normalizada
--      | ordinal de ocorrência). O ordinal é o que permite duas compras
--      idênticas de verdade no mesmo dia (dois cafés de R$ 5,00) coexistirem:
--      viram ocorrência 1 e 2. Reimportar o mesmo arquivo recalcula 1 e 2,
--      ambas colidem, zero novas. Sem ordinal, o segundo café seria recusado
--      para sempre — falso positivo pior que o problema original.
--   4. Classificação NOVO | DUPLICADO | AMBIGUO substitui o booleano.
--   5. confirmar_importacao NUNCA materializa DUPLICADO, mesmo que a UI
--      mande ignorar = false (defesa em profundidade: a regra vive no banco).
--
-- Sem extensão nova: sha256(bytea) é nativo no PG 17 e IMMUTABLE; o
-- dobramento de acento usa translate() em vez de unaccent (que não é
-- immutable por padrão e portanto não serve para índice).
-- =====================================================================

-- ---------------------------------------------------------------- 1. Normalização
-- IMMUTABLE porque entra em índice e em fingerprint persistido: mudar esta
-- função depois invalida silenciosamente todo fingerprint já gravado.
-- Qualquer alteração aqui exige recomputar a coluna (ver seção 6).
create or replace function public.fn_normalizar_descricao(p_descricao text)
returns text
language sql
immutable
strict
set search_path = ''
as $$
  select btrim(
    regexp_replace(
      regexp_replace(
        translate(
          lower(p_descricao),
          'áàâãäéèêëíìîïóòôõöúùûüçñ',
          'aaaaaeeeeiiiiooooouuuucn'
        ),
        '[^a-z0-9 ]', ' ', 'g'   -- pontuação e símbolo viram espaço
      ),
      '\s+', ' ', 'g'            -- colapsa espaço interno
    )
  );
$$;

comment on function public.fn_normalizar_descricao(text) is
  'Descrição canônica para dedup: minúscula, sem acento, sem pontuação, espaço colapsado. IMMUTABLE — alterar invalida fingerprints gravados.';

-- ---------------------------------------------------------------- 2. Fingerprint
-- Valor vai COM SINAL: -500 (despesa de R$5) e +500 (receita de R$5) no mesmo
-- dia com a mesma descrição são transações diferentes, não duplicata.
create or replace function public.fn_fingerprint_transacao(
  p_data       date,
  p_centavos   bigint,
  p_descricao  text,
  p_ocorrencia int default 1
)
returns text
language sql
immutable
strict
set search_path = ''
as $$
  select encode(
    sha256(convert_to(
      to_char(p_data, 'YYYY-MM-DD') || '|' ||
      p_centavos::text              || '|' ||
      public.fn_normalizar_descricao(p_descricao) || '|' ||
      p_ocorrencia::text,
      'UTF8'
    )),
    'hex'
  );
$$;

comment on function public.fn_fingerprint_transacao(date, bigint, text, int) is
  'sha256(data|centavos com sinal|descrição normalizada|ordinal). O ordinal permite repetição legítima no mesmo dia sem quebrar a idempotência da reimportação.';

-- ---------------------------------------------------------------- 3. Colunas
alter table public.transacoes_origem
  add column if not exists id_externo  text,
  add column if not exists fingerprint text;

comment on column public.transacoes_origem.id_externo is
  'Identificador do provedor (FITID do OFX, id da Pluggy). Quando presente, tem precedência sobre o fingerprint na dedup.';
comment on column public.transacoes_origem.fingerprint is
  'fn_fingerprint_transacao(...). Null em lançamento manual — a rede de segurança só vale para linha vinda de importação.';

alter table public.importacao_linhas
  add column if not exists id_externo    text,
  add column if not exists fingerprint   text,
  add column if not exists classificacao text not null default 'NOVO';

-- Constraint separada do add column para ser idempotente em re-execução.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'importacao_linhas_classificacao_check'
  ) then
    alter table public.importacao_linhas
      add constraint importacao_linhas_classificacao_check
      check (classificacao in ('NOVO','DUPLICADO','AMBIGUO'));
  end if;
end $$;

comment on column public.importacao_linhas.classificacao is
  'NOVO = grava. DUPLICADO = já existe no razão, nunca grava. AMBIGUO = mesma data e valor com descrição diferente; nasce ignorada, o usuário decide.';

-- ---------------------------------------------------------------- 4. Rede de segurança
-- Parciais: só restringem linha COM identificador de origem e viva. Lançamento
-- manual (fingerprint null) e soft-delete ficam de fora — reimportar algo que
-- foi excluído deve voltar a ser permitido.
create unique index if not exists transacoes_id_externo_uidx
  on public.transacoes_origem (user_id, id_externo)
  where id_externo is not null and deleted_at is null;

create unique index if not exists transacoes_fingerprint_uidx
  on public.transacoes_origem (user_id, fingerprint)
  where fingerprint is not null and deleted_at is null;

-- Classificação AMBIGUO consulta por (user_id, data, valor) sem descrição.
create index if not exists transacoes_data_valor_tipo_idx
  on public.transacoes_origem (user_id, data_compra, valor_total, tipo)
  where deleted_at is null;

-- ---------------------------------------------------------------- 5. Backfill
-- Sem isto, reimportar um extrato antigo veria como NOVO tudo que já está no
-- razão — o critério "dashboard do mês sem double-count" só valeria para
-- importações futuras. O ordinal reproduz a mesma regra do staging:
-- row_number() sobre o trio, ordenado de forma estável (created_at, id).
-- Reversível: update public.transacoes_origem set fingerprint = null;
with numeradas as (
  select
    t.id,
    row_number() over (
      partition by t.user_id, t.data_compra,
                   case when t.tipo = 'DESPESA' then -t.valor_total else t.valor_total end,
                   public.fn_normalizar_descricao(t.descricao)
      order by t.created_at, t.id
    ) as ocorrencia,
    case when t.tipo = 'DESPESA' then -t.valor_total else t.valor_total end as centavos
  from public.transacoes_origem t
  where t.deleted_at is null
    and t.fingerprint is null
)
update public.transacoes_origem t
   set fingerprint = public.fn_fingerprint_transacao(
         t.data_compra, n.centavos, t.descricao, n.ocorrencia::int)
  from numeradas n
 where n.id = t.id;

-- ---------------------------------------------------------------- 6. criar_importacao
-- Substitui a versão da 0018. Mudanças: aceita id_externo opcional por linha,
-- calcula ordinal DENTRO do lote, grava fingerprint e classifica em três
-- estados. Mantém intactas as guardas da 0018 (tipo de valor, teto de linhas,
-- janela de data) — elas não são escopo desta entrega.
create or replace function public.criar_importacao(
  p_origem text,
  p_linhas jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_id      uuid;
  v_total   int;
  v_gravadas int;
  v_novo    int;
  v_dup     int;
  v_amb     int;
begin
  if v_user_id is null then
    raise exception 'Não autenticado.'
      using errcode = 'FW401', hint = 'Sessão ausente/expirada. Não retente; reautentique.';
  end if;
  if p_origem not in ('CSV','OFX','OFC','XLSX','PDF','PLUGGY') then
    raise exception 'origem inválida: %', p_origem
      using errcode = 'FW400', hint = 'Use CSV, OFX, OFC, XLSX, PDF ou PLUGGY.';
  end if;
  if p_linhas is null or jsonb_typeof(p_linhas) <> 'array' then
    raise exception 'p_linhas deve ser um array JSON.'
      using errcode = 'FW400', hint = 'Envie [{data, valor, descricao, id_externo?}, ...].';
  end if;
  v_total := jsonb_array_length(p_linhas);
  if v_total < 1 or v_total > 1000 then
    raise exception 'Importação com % linhas (mínimo 1, máximo 1000).', v_total
      using errcode = 'FW429', hint = 'Divida o arquivo em lotes de até 1000 linhas.';
  end if;

  -- Guarda de tipo da 0018: valor fracionário vira FW400 em vez de erro cru
  -- do cast jsonb->bigint dentro de jsonb_to_recordset.
  if exists (
    select 1 from jsonb_array_elements(p_linhas) e
    where jsonb_typeof(e -> 'valor') = 'number'
      and (e ->> 'valor') ~ '[.,]'
  ) then
    raise exception 'Campo valor deve ser inteiro em centavos.'
      using errcode = 'FW400',
            hint = 'Converta reais para centavos na borda (R$ 42,00 -> 4200). Não envie fração.';
  end if;

  insert into public.importacoes (user_id, origem)
  values (v_user_id, p_origem)
  returning id into v_id;

  -- Uma passada set-based em três camadas:
  --   validas    -> filtro e normalização (mesmas regras da 0018)
  --   ordenadas  -> ordinal de ocorrência DENTRO do lote + fingerprint
  --   classify   -> confronto com o razão
  -- Ordinal por ordem de aparição no arquivo (ordinality), não por data:
  -- reimportar o mesmo arquivo tem que reproduzir exatamente os mesmos
  -- números, e a ordem das linhas é a única coisa estável entre execuções.
  with validas as (
    select
      l.ord,
      l.data,
      l.valor,
      trim(l.descricao)                                  as descricao,
      nullif(trim(coalesce(l.id_externo, '')), '')       as id_externo
    -- ROWS FROM(): `WITH ORDINALITY` não aceita lista de definição de coluna
    -- direto em jsonb_to_recordset (erro 42601). Verificado por execução.
    from rows from (
           jsonb_to_recordset(p_linhas)
             as (data date, valor bigint, descricao text, id_externo text)
         ) with ordinality as l(data, valor, descricao, id_externo, ord)
    where l.data is not null
      and l.valor is not null and l.valor <> 0
      and coalesce(trim(l.descricao), '') <> ''
      and l.data between date '2000-01-01'
          and (now() at time zone 'America/Sao_Paulo')::date + 1
  ),
  ordenadas as (
    select
      v.*,
      row_number() over (
        partition by v.data, v.valor, public.fn_normalizar_descricao(v.descricao)
        order by v.ord
      )::int as ocorrencia,
      -- Repetição do MESMO id_externo dentro do arquivo é defeito do arquivo,
      -- não transação nova: só a primeira vale.
      case when v.id_externo is null then 1
           else row_number() over (partition by v.id_externo order by v.ord)::int
      end as ocorrencia_id_ext
    from validas v
  ),
  comfp as (
    select
      o.*,
      public.fn_fingerprint_transacao(o.data, o.valor, o.descricao, o.ocorrencia) as fp
    from ordenadas o
  ),
  classificadas as (
    select
      c.*,
      case
        when c.ocorrencia_id_ext > 1 then 'DUPLICADO'
        when c.id_externo is not null and exists (
               select 1 from public.transacoes_origem t
               where t.user_id = v_user_id and t.deleted_at is null
                 and t.id_externo = c.id_externo
             ) then 'DUPLICADO'
        when exists (
               select 1 from public.transacoes_origem t
               where t.user_id = v_user_id and t.deleted_at is null
                 and t.fingerprint = c.fp
             ) then 'DUPLICADO'
        -- Mesma data e mesmo valor com sinal, descrição diferente: forte
        -- indício de ser o mesmo lançamento com outro rótulo do banco.
        when exists (
               select 1 from public.transacoes_origem t
               where t.user_id = v_user_id and t.deleted_at is null
                 and t.data_compra = c.data
                 and t.valor_total = abs(c.valor)
                 and t.tipo = case when c.valor < 0 then 'DESPESA' else 'RECEITA' end
             ) then 'AMBIGUO'
        else 'NOVO'
      end as classificacao
    from comfp c
  )
  insert into public.importacao_linhas
    (importacao_id, user_id, data, valor, descricao, categoria_sugerida,
     id_externo, fingerprint, classificacao, duplicada, ignorar)
  select
    v_id, v_user_id, k.data, k.valor, k.descricao,
    case when k.valor < 0
         then public.fn_sugerir_categoria(v_user_id, k.descricao) end,
    k.id_externo, k.fp, k.classificacao,
    k.classificacao = 'DUPLICADO',
    -- DUPLICADO e AMBIGUO nascem ignorados; só NOVO já vem marcado para gravar.
    k.classificacao <> 'NOVO'
  from classificadas k;

  get diagnostics v_gravadas = row_count;
  if v_gravadas <> v_total then
    raise exception 'Lote rejeitado: % de % linhas válidas.', v_gravadas, v_total
      using errcode = 'FW400',
            hint = 'Toda linha precisa de data plausível (2000-01-01..amanhã), valor <> 0 em centavos e descrição.';
  end if;

  select
    count(*) filter (where classificacao = 'NOVO'),
    count(*) filter (where classificacao = 'DUPLICADO'),
    count(*) filter (where classificacao = 'AMBIGUO')
    into v_novo, v_dup, v_amb
  from public.importacao_linhas
  where importacao_id = v_id;

  return jsonb_build_object(
    'importacao_id', v_id,
    'linhas',        v_total,
    'novos',         v_novo,
    'duplicadas',    v_dup,   -- nome preservado: a UI atual já lê esta chave
    'ambiguos',      v_amb);
end;
$$;

-- ---------------------------------------------------------------- 7. confirmar_importacao
-- Substitui a versão da 0009. Muda: persiste id_externo/fingerprint e filtra
-- DUPLICADO no próprio SQL — a regra "duplicado nunca materializa" deixa de
-- depender da UI mandar ignorar = true.
create or replace function public.confirmar_importacao(p_importacao_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_imp     public.importacoes%rowtype;
  v_criadas int;
begin
  if v_user_id is null then
    raise exception 'Não autenticado.'
      using errcode = 'FW401', hint = 'Sessão ausente/expirada. Não retente; reautentique.';
  end if;

  select * into v_imp
  from public.importacoes
  where id = p_importacao_id and user_id = v_user_id and deleted_at is null
  for update;  -- serializa duplo-clique em "Confirmar"
  if not found then
    raise exception 'Importação % não encontrada para este usuário.', p_importacao_id
      using errcode = 'FW404', hint = 'Confira o id da importação.';
  end if;
  if v_imp.status <> 'REVISAO' then
    raise exception 'Importação % já está %.', p_importacao_id, v_imp.status
      using errcode = 'FW409',
            hint = 'Commit é único por importação — as transações já foram criadas (ou o lote foi descartado). Não retente.';
  end if;

  with alvo as (
    select data, abs(valor) as valor_abs,
           case when valor < 0 then 'DESPESA' else 'RECEITA' end as tipo,
           descricao, categoria_sugerida, id_externo, fingerprint
    from public.importacao_linhas
    where importacao_id = v_imp.id and user_id = v_user_id
      and deleted_at is null
      and not ignorar
      -- Rede de segurança nº 2: DUPLICADO não materializa nem que a UI peça.
      and classificacao <> 'DUPLICADO'
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
  insert into public.parcelas
    (user_id, transacao_id, fatura_id, numero, valor, data_competencia)
  select v_user_id, n.id, null, 1, n.valor_total, n.data_compra
  from novas n;
  get diagnostics v_criadas = row_count;

  update public.importacoes set status = 'CONFIRMADA' where id = v_imp.id;

  return jsonb_build_object(
    'importacao_id', v_imp.id, 'transacoes_criadas', v_criadas);
exception
  when unique_violation then
    -- Rede de segurança nº 3: só chega aqui se a classificação errou (corrida
    -- entre dois confirms, ou linha gravada por outro caminho no intervalo).
    -- Aborta o lote inteiro em vez de gravar metade.
    raise exception 'Importação % colidiu com transação já existente.', p_importacao_id
      using errcode = 'FW409',
            hint = 'Alguma linha já foi gravada por outra importação. Descarte este lote e reimporte o arquivo para reclassificar.';
end;
$$;

-- ---------------------------------------------------------------- 8. Privilégios
-- criar_importacao e confirmar_importacao mantêm a mesma assinatura, então os
-- grants da 0009 continuam válidos. As funções novas são puras e read-only,
-- mas ficam fora do alcance de anon por padrão do projeto.
revoke execute on function public.fn_normalizar_descricao(text)                      from public, anon;
revoke execute on function public.fn_fingerprint_transacao(date, bigint, text, int)   from public, anon;
grant  execute on function public.fn_normalizar_descricao(text)                      to authenticated;
grant  execute on function public.fn_fingerprint_transacao(date, bigint, text, int)   to authenticated;
