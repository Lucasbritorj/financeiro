-- =====================================================================
-- 0023_conciliacao_fatura_extrato.sql
-- Evita contar duas vezes o mesmo consumo quando o extrato importado traz
-- a linha de pagamento da fatura e as compras daquela fatura já existem
-- como parcelas de cartão.
--
-- O DEFEITO, nas duas faces (auditado antes de escrever):
--
-- Face A — competência. insights.ts:72 resumoDoMes e :83 gastoPorCategoria
-- somam TODA transacoes_origem do mês por data_compra, separando só por
-- `tipo` — não olham forma_pagamento. Compra de R$ 500 no crédito em 05/03
-- conta em março; o "PAGAMENTO FATURA" de R$ 500 importado em 10/04 vira
-- uma transação DEBITO e conta em abril. R$ 1.000 no total, em MESES
-- DIFERENTES — não parece duplicata, parece gasto legítimo, e a dedup da
-- 0020/0021 corretamente não pega (são lançamentos distintos).
--
-- Face B — caixa. vw_carteira.saldo_caixa = entradas − saidas_avista
-- − faturas_pagas − boletos_pagos. O pagamento importado entra em
-- saidas_avista (é DEBITO) e a mesma fatura entra em faturas_pagas.
--
-- A armadilha que isso cria hoje: a Face B só dispara se a fatura estiver
-- PAGA. Quem nunca usa o botão "pagar fatura" e só importa o extrato não
-- sofre double-count na carteira — mas fica com a fatura eternamente em
-- vw_contas_a_pagar. Ou seja: hoje o usuário escolhe entre contar duas
-- vezes e ter conta fantasma. Não existe caminho certo.
--
-- POR QUE `natureza` E NÃO UM `tipo` NOVO:
-- vw_faturas_consolidadas faz `case when t.tipo='RECEITA' then -p.valor
-- else p.valor`. Um terceiro valor de `tipo` cairia no ELSE e seria somado
-- como despesa nas views — diff grande, risco alto. Coluna nova é aditiva.
--
-- POR QUE NÃO REUSAR O ENUM DE DEDUP (NOVO|DUPLICADO|AMBIGUO):
-- são eixos ortogonais. Uma linha pode ser NOVO e liquidação, ou DUPLICADO
-- e liquidação. Espremer os dois no mesmo campo forçaria breaking change
-- em criar_importacao/confirmar_importacao e na UI sem ganho.
--
-- NÃO MUDA: fn_normalizar_descricao, fn_fingerprint_transacao, formato do
-- fingerprint, unique indexes da 0020/0021, enum de classificação.
-- =====================================================================

-- ---------------------------------------------------------------- 1. Colunas
-- Default 'CONSUMO' no próprio add column: aqui o backfill automático é
-- CORRETO (ao contrário de `source` na 0021). Auditoria confirmou 0 linhas
-- candidatas a pagamento de fatura no histórico — toda linha existente é
-- consumo de fato, não estou inventando classificação.
alter table public.transacoes_origem
  add column if not exists natureza text not null default 'CONSUMO',
  add column if not exists fatura_liquidada_id uuid references public.faturas (id);

do $do$
begin
  if not exists (select 1 from pg_constraint where conname='transacoes_natureza_check') then
    alter table public.transacoes_origem add constraint transacoes_natureza_check
      check (natureza in ('CONSUMO','LIQUIDACAO_FATURA'));
  end if;
  -- Liquidação é saída de caixa: nunca nasce como compra no crédito.
  if not exists (select 1 from pg_constraint where conname='transacoes_liquidacao_nao_credito_check') then
    alter table public.transacoes_origem add constraint transacoes_liquidacao_nao_credito_check
      check (natureza <> 'LIQUIDACAO_FATURA' or forma_pagamento <> 'CREDITO');
  end if;
  -- Vínculo com fatura só faz sentido em liquidação.
  if not exists (select 1 from pg_constraint where conname='transacoes_fatura_liquidada_coerente_check') then
    alter table public.transacoes_origem add constraint transacoes_fatura_liquidada_coerente_check
      check (fatura_liquidada_id is null or natureza = 'LIQUIDACAO_FATURA');
  end if;
end $do$;

comment on column public.transacoes_origem.natureza is
  'CONSUMO = despesa/receita real, soma nos relatórios. LIQUIDACAO_FATURA = pagamento de fatura de cartão: saída de caixa que quita consumo JÁ contado nas parcelas — não soma de novo.';
comment on column public.transacoes_origem.fatura_liquidada_id is
  'Fatura que este lançamento quitou. Só preenchido quando a detecção casou valor exato. NÃO altera o status da fatura — isso é ação explícita do usuário.';

-- Staging: eixo separado do enum de dedup, de propósito.
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

comment on column public.importacao_linhas.liquidacao_sugerida is
  'A descrição parece pagamento de fatura mas NENHUMA fatura casou por valor exato. A linha é gravada como CONSUMO (comportamento atual, sem regressão) e a UI pergunta. Ver nota "candidata" na 0023.';

-- ---------------------------------------------------------------- 2. Detecção por descrição
-- Determinística, sem LLM. Opera sobre fn_normalizar_descricao, que já
-- tirou acento e pontuação e colapsou espaço — então "PAGAMENTO  FATURA!"
-- e "Pgto. Fatura" caem no mesmo texto.
-- Conservador de propósito: falso positivo aqui ESCONDE dinheiro do
-- relatório, que é falha silenciosa na direção errada.
create or replace function public.fn_parece_pagamento_fatura(p_descricao text)
returns boolean
language sql
immutable
strict
set search_path = ''
as $fn$
  select public.fn_normalizar_descricao(p_descricao) ~
    '(^| )(pagamento|pgto|pagto|pag)( de)? (fatura|cartao de credito)( |$)|(^| )fatura (do )?cartao( |$)|(^| )pagamento cartao( |$)';
$fn$;

comment on function public.fn_parece_pagamento_fatura(text) is
  'Heurística de TEXTO apenas — nunca decide sozinha. Só vira LIQUIDACAO_FATURA quando uma fatura casa por valor exato (ver fn_fatura_liquidada_por).';

-- ---------------------------------------------------------------- 3. Match da fatura
-- Regra fechada com o dono do produto:
--   * valor EXATO (sem tolerância percentual);
--   * data do lançamento dentro de ±5 dias do vencimento da fatura;
--   * qualquer status — inclusive PAGA, porque é justamente quando a fatura
--     foi marcada paga à mão que a Face B do double-count aparece;
--   * empate (duas faturas casando) NÃO decide: devolve null e vira sugestão.
create or replace function public.fn_fatura_liquidada_por(
  p_user_id   uuid,
  p_data      date,
  p_centavos  bigint   -- valor COM sinal, como vem do staging
)
returns uuid
language sql
stable
set search_path = ''
as $fn$
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
         -- 2+ candidatas: existe uma estritamente mais próxima? então ela.
         when (select count(*) from candidatas c
               where c.distancia = (select min(distancia) from candidatas)) = 1
              then (select id from candidatas order by distancia limit 1)
         else null   -- empate real: não decide
    end;
$fn$;

comment on function public.fn_fatura_liquidada_por(uuid, date, bigint) is
  'Fatura quitada por um lançamento, ou NULL. Valor exato + janela de ±5 dias do vencimento. Empate de distância devolve NULL de propósito: ambiguidade vira decisão do usuário, não do banco.';

-- ---------------------------------------------------------------- 4. criar_importacao
-- Só acrescenta as três colunas novas ao insert. A classificação de dedup
-- (NOVO|DUPLICADO|AMBIGUO) e todo o pipeline da 0020/0021 ficam intactos.
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
        'linhas', v_total, 'novos', 0, 'duplicadas', v_total,
        'ambiguos', 0, 'liquidacoes', 0);
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
      'linhas', v_total, 'novos', 0, 'duplicadas', v_total,
      'ambiguos', 0, 'liquidacoes', 0);
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
      -- Eixo ORTOGONAL ao de dedup.
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
    -- Liquidação não recebe categoria: não é gasto de categoria nenhuma.
    case when k.valor < 0 and k.fatura_id is null
         then public.fn_sugerir_categoria(v_user_id, k.descricao) end,
    k.id_externo, k.fp, k.classificacao,
    k.classificacao='DUPLICADO', k.classificacao <> 'NOVO',
    case when k.fatura_id is not null then 'LIQUIDACAO_FATURA' else 'CONSUMO' end,
    k.fatura_id,
    -- Sugerida = texto casou mas NENHUMA fatura bateu por valor exato.
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

-- ---------------------------------------------------------------- 5. confirmar_importacao
-- Materializa natureza e fatura_liquidada_id. NÃO toca no status da fatura:
-- decisão do dono do produto — escrita de status só com ação explícita.
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

-- ---------------------------------------------------------------- 6. vw_carteira
-- Uma linha muda: saidas_avista passa a exigir natureza='CONSUMO'.
-- Quem subtrai a fatura continua sendo faturas_pagas — a liquidação NÃO
-- vira segunda subtração. Definição fiel à vigente + o predicado novo nos
-- dois lugares onde saidas_avista aparece (o campo e dentro de saldo_caixa).
create or replace view public.vw_carteira
with (security_invoker = true)
as
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

-- ---------------------------------------------------------------- 7. Índices e privilégios
create index if not exists transacoes_natureza_idx
  on public.transacoes_origem (user_id, natureza)
  where deleted_at is null and natureza <> 'CONSUMO';

revoke execute on function public.fn_parece_pagamento_fatura(text)              from public, anon;
revoke execute on function public.fn_fatura_liquidada_por(uuid, date, bigint)   from public, anon;
grant  execute on function public.fn_parece_pagamento_fatura(text)              to authenticated;
grant  execute on function public.fn_fatura_liquidada_por(uuid, date, bigint)   to authenticated;

-- A 0022 tirou TRUNCATE/REFERENCES/TRIGGER do default de public; a view
-- recriada acima precisa do SELECT de volta para authenticated.
grant select on public.vw_carteira to authenticated;
revoke insert, update, delete on public.vw_carteira from anon, authenticated;
