-- =====================================================================
-- 0013_boletos.sql
-- BOLETO = conta a pagar com vencimento (luz, água, gás, internet…): gasto
-- fixo mensal de valor variável. Conceitualmente idêntico à fatura de cartão:
-- entra na COMPETÊNCIA ("onde gasto") agora e só sai do CAIXA quando pago.
--
-- Modelagem (decisão de arquitetura):
--   * Boleto NÃO é tabela nova — é uma transacao_origem com
--     forma_pagamento='BOLETO' + coluna data_vencimento. Assim herda de
--     graça: categorização automática (trigger 0008), donut/insights/análise
--     (que leem transacoes_origem por data_compra) e histórico. Uma tabela
--     separada deixaria luz/água/gás invisíveis ao assistente de análise —
--     justo os maiores gastos fixos.
--   * O estado "a pagar/pago" reutiliza a PARCELA única (status PENDENTE/PAGA
--     + data_pagamento, já existentes). Pagar = baixar a parcela.
--   * data_compra do boleto = COMPETÊNCIA do gasto (pode ser mês futuro, como
--     as parcelas de crédito). data_vencimento = quando vence de fato.
--
-- Caixa: vw_carteira ganha o termo "boletos_pagos" (subtrai). Boleto pendente
-- não toca o caixa; ao pagar, sai da carteira — sem duplicata (o gasto já
-- estava na competência, o pagamento é a saída de caixa que o quita).
--
-- Apresentação: vw_contas_a_pagar unifica faturas não pagas ∪ boletos
-- pendentes numa lista só, ordenável por vencimento.
--
-- Padrões do projeto: RPC SECURITY DEFINER + search_path='' + escopo
-- auth.uid() em toda query + FW4xx com hint. DML direto continua revogado.
-- =====================================================================

-- ------------------- 1. SCHEMA: nova forma + vencimento -------------------
-- CHECK inline de forma_pagamento (0001) tem nome auto-gerado; troca por um
-- nomeado que inclui BOLETO. As demais constraints de 0001 já acomodam boleto:
--   parcelamento_so_credito: BOLETO tem num_parcelas=1 (ok).
--   credito_exige_cartao:    BOLETO <> CREDITO, cartao_id nulo (ok).
alter table public.transacoes_origem
  drop constraint if exists transacoes_origem_forma_pagamento_check;
alter table public.transacoes_origem
  add constraint transacoes_origem_forma_pagamento_check
  check (forma_pagamento in ('CREDITO','DEBITO','PIX','DINHEIRO','BOLETO'));

alter table public.transacoes_origem
  add column if not exists data_vencimento date;

-- Coerência: vencimento existe se, e só se, for boleto. Todas as linhas
-- pré-existentes têm data_vencimento nulo (coluna recém-criada) e forma
-- <> BOLETO, então a constraint valida sem backfill.
alter table public.transacoes_origem
  drop constraint if exists boleto_vencimento_coerente;
alter table public.transacoes_origem
  add constraint boleto_vencimento_coerente
  check (
    (forma_pagamento =  'BOLETO' and data_vencimento is not null)
    or
    (forma_pagamento <> 'BOLETO' and data_vencimento is null)
  );

-- Índice para ordenar contas a pagar por vencimento (só boletos ativos).
create index if not exists transacoes_vencimento_idx
  on public.transacoes_origem (data_vencimento)
  where forma_pagamento = 'BOLETO' and deleted_at is null;

-- ------------------- 2. RPC: criar_boleto -------------------
-- Insere a transacao (forma=BOLETO) + a parcela única PENDENTE. A competência
-- (data_compra) default = 1º dia do mês do vencimento; o gasto pode ser de mês
-- futuro (boleto que vence mês que vem), por isso a janela temporal é mais
-- larga que a de processar_transacao_completa.
create or replace function public.criar_boleto(
  p_descricao        text,
  p_valor            bigint,             -- centavos
  p_data_vencimento  date,
  p_data_competencia date default null,  -- null = 1º dia do mês do vencimento
  p_categoria_id     uuid default null   -- null = trigger 0008 autocategoriza
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id      uuid := auth.uid();
  v_comp         date;
  v_transacao_id uuid;
begin
  if v_user_id is null then
    raise exception 'Não autenticado.'
      using errcode = 'FW401', hint = 'Sessão ausente/expirada. Não retente; reautentique.';
  end if;
  if coalesce(trim(p_descricao), '') = '' then
    raise exception 'descricao é obrigatória.'
      using errcode = 'FW400', hint = 'Informe uma descrição e chame novamente.';
  end if;
  if p_valor is null or p_valor <= 0 then
    raise exception 'valor deve ser positivo, em centavos. Recebido: %', p_valor
      using errcode = 'FW400', hint = 'Envie o valor em centavos (inteiro > 0).';
  end if;
  if p_data_vencimento is null then
    raise exception 'data_vencimento é obrigatória para boleto.'
      using errcode = 'FW400', hint = 'Informe a data de vencimento.';
  end if;
  -- Vencimento plausível: atrasado (passado) ok; futuro até 5 anos.
  if p_data_vencimento < date '2000-01-01'
     or p_data_vencimento > (now() at time zone 'America/Sao_Paulo')::date + interval '5 years' then
    raise exception 'data_vencimento fora do intervalo plausível: %', p_data_vencimento
      using errcode = 'FW400', hint = 'Use uma data entre 2000-01-01 e +5 anos.';
  end if;

  -- Competência: default = mês do vencimento. Aceita mês futuro (até +1 ano)
  -- porque um boleto que vence adiante é um gasto de competência futura.
  v_comp := coalesce(p_data_competencia, date_trunc('month', p_data_vencimento)::date);
  if v_comp < date '2000-01-01'
     or v_comp > (now() at time zone 'America/Sao_Paulo')::date + interval '1 year' then
    raise exception 'competência fora do intervalo plausível: %', v_comp
      using errcode = 'FW400', hint = 'Use uma competência entre 2000-01-01 e +1 ano.';
  end if;

  -- Categoria explícita, se veio, precisa ser do usuário.
  if p_categoria_id is not null and not exists (
      select 1 from public.categorias
      where id = p_categoria_id and user_id = v_user_id and deleted_at is null) then
    raise exception 'Categoria % não encontrada para este usuário.', p_categoria_id
      using errcode = 'FW404', hint = 'Confira o id da categoria.';
  end if;

  insert into public.transacoes_origem
    (user_id, descricao, valor_total, tipo, forma_pagamento, cartao_id,
     data_compra, num_parcelas, data_vencimento, categoria_id)
  values
    (v_user_id, trim(p_descricao), p_valor, 'DESPESA', 'BOLETO', null,
     v_comp, 1, p_data_vencimento, p_categoria_id)   -- trigger autocategoriza se null
  returning id into v_transacao_id;

  -- Parcela única: PENDENTE = "a pagar". data_competencia = competência.
  insert into public.parcelas
    (user_id, transacao_id, fatura_id, numero, valor, data_competencia)
  values
    (v_user_id, v_transacao_id, null, 1, p_valor, v_comp);

  return jsonb_build_object(
    'transacao_id',   v_transacao_id,
    'data_vencimento', p_data_vencimento,
    'competencia',    v_comp,
    'status',         'A_PAGAR');
end;
$$;

-- ------------------- 3. RPC: pagar_boleto -------------------
-- Baixa a parcela única do boleto (PENDENTE -> PAGA). Espelha
-- processar_pagamento_fatura: idempotência dura (2º pagamento cai no FW409).
-- Ao pagar, o valor entra em vw_carteira.boletos_pagos (sai do caixa).
create or replace function public.pagar_boleto(
  p_transacao_id   uuid,
  p_data_pagamento timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_t       public.transacoes_origem%rowtype;
  v_parcela public.parcelas%rowtype;
begin
  if v_user_id is null then
    raise exception 'Não autenticado.'
      using errcode = 'FW401', hint = 'Sessão ausente/expirada. Não retente; reautentique.';
  end if;
  if p_transacao_id is null then
    raise exception 'p_transacao_id é obrigatório.'
      using errcode = 'FW400', hint = 'Informe o uuid do boleto.';
  end if;
  if p_data_pagamento is not null
     and (p_data_pagamento > now() + interval '1 day'
          or p_data_pagamento < timestamptz '2000-01-01 00:00Z') then
    raise exception 'data_pagamento fora do intervalo plausível: %', p_data_pagamento
      using errcode = 'FW400', hint = 'Use uma data entre 2000-01-01 e amanhã.';
  end if;

  select * into v_t
  from public.transacoes_origem
  where id = p_transacao_id and user_id = v_user_id and deleted_at is null
    and forma_pagamento = 'BOLETO'
  for update;
  if not found then
    raise exception 'Boleto % não encontrado para este usuário.', p_transacao_id
      using errcode = 'FW404', hint = 'Confira o id; o boleto pode estar excluído ou não ser BOLETO.';
  end if;

  -- FOR UPDATE serializa dois pagamentos simultâneos: o 2º vê PAGA e falha.
  select * into v_parcela
  from public.parcelas
  where transacao_id = v_t.id and user_id = v_user_id and deleted_at is null
  for update;
  if not found then
    raise exception 'Boleto % sem parcela ativa.', p_transacao_id
      using errcode = 'FW500', hint = 'Falha interna; reporte com a mensagem completa.';
  end if;
  if v_parcela.status = 'PAGA' then
    raise exception 'Boleto % já está PAGO.', p_transacao_id
      using errcode = 'FW409', hint = 'Pagamento já aplicado; não repita a operação.';
  end if;

  update public.parcelas
     set status = 'PAGA',
         data_pagamento = coalesce(p_data_pagamento, now())
   where id = v_parcela.id;

  return jsonb_build_object(
    'transacao_id',  v_t.id,
    'status',        'PAGA',
    'valor',         v_t.valor_total,
    'data_pagamento', coalesce(p_data_pagamento, now()));
end;
$$;

-- ------------------- 4. RPC: editar_boleto -------------------
-- Edição focada em boleto: descrição, valor (sincroniza a parcela única),
-- vencimento, competência e categoria. Boleto PAGO é histórico — não se edita
-- (FW409), coerente com editar_transacao. Janela de competência mais larga
-- que editar_transacao (aceita mês futuro).
create or replace function public.editar_boleto(
  p_transacao_id     uuid,
  p_descricao        text   default null,   -- null = mantém
  p_valor            bigint default null,   -- centavos; null = mantém
  p_data_vencimento  date   default null,   -- null = mantém
  p_data_competencia date   default null,   -- null = mantém
  p_categoria_id     uuid   default null,   -- null = mantém
  p_alterar_categoria boolean default false -- true = aplica p_categoria_id (inclusive null p/ remover)
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_t       public.transacoes_origem%rowtype;
  v_desc    text;
  v_valor   bigint;
  v_venc    date;
  v_comp    date;
begin
  if v_user_id is null then
    raise exception 'Não autenticado.'
      using errcode = 'FW401', hint = 'Sessão ausente/expirada. Não retente; reautentique.';
  end if;
  if p_transacao_id is null then
    raise exception 'p_transacao_id é obrigatório.'
      using errcode = 'FW400', hint = 'Informe o uuid do boleto.';
  end if;

  select * into v_t
  from public.transacoes_origem
  where id = p_transacao_id and user_id = v_user_id and deleted_at is null
    and forma_pagamento = 'BOLETO'
  for update;
  if not found then
    raise exception 'Boleto % não encontrado para este usuário.', p_transacao_id
      using errcode = 'FW404', hint = 'Confira o id; o boleto pode estar excluído ou não ser BOLETO.';
  end if;

  if exists (select 1 from public.parcelas
             where transacao_id = v_t.id and user_id = v_user_id
               and status = 'PAGA' and deleted_at is null) then
    raise exception 'Boleto % já está PAGO — não pode ser editado.', p_transacao_id
      using errcode = 'FW409', hint = 'Histórico pago não se edita.';
  end if;

  v_desc  := coalesce(nullif(trim(coalesce(p_descricao, '')), ''), v_t.descricao);
  v_valor := coalesce(p_valor, v_t.valor_total);
  v_venc  := coalesce(p_data_vencimento, v_t.data_vencimento);
  v_comp  := coalesce(p_data_competencia, v_t.data_compra);

  if v_valor <= 0 then
    raise exception 'valor deve ser positivo, em centavos. Recebido: %', v_valor
      using errcode = 'FW400', hint = 'Envie o valor em centavos (inteiro > 0).';
  end if;
  if v_venc < date '2000-01-01'
     or v_venc > (now() at time zone 'America/Sao_Paulo')::date + interval '5 years' then
    raise exception 'data_vencimento fora do intervalo plausível: %', v_venc
      using errcode = 'FW400', hint = 'Use uma data entre 2000-01-01 e +5 anos.';
  end if;
  if v_comp < date '2000-01-01'
     or v_comp > (now() at time zone 'America/Sao_Paulo')::date + interval '1 year' then
    raise exception 'competência fora do intervalo plausível: %', v_comp
      using errcode = 'FW400', hint = 'Use uma competência entre 2000-01-01 e +1 ano.';
  end if;
  if p_alterar_categoria and p_categoria_id is not null and not exists (
      select 1 from public.categorias
      where id = p_categoria_id and user_id = v_user_id and deleted_at is null) then
    raise exception 'Categoria % não encontrada para este usuário.', p_categoria_id
      using errcode = 'FW404', hint = 'Confira o id da categoria.';
  end if;

  update public.transacoes_origem
     set descricao       = v_desc,
         valor_total     = v_valor,
         data_vencimento = v_venc,
         data_compra     = v_comp,
         categoria_id    = case when p_alterar_categoria then p_categoria_id else categoria_id end
   where id = v_t.id;

  -- Parcela única acompanha valor e competência.
  update public.parcelas
     set valor = v_valor,
         data_competencia = v_comp
   where transacao_id = v_t.id and user_id = v_user_id and deleted_at is null;

  return jsonb_build_object('transacao_id', v_t.id);
end;
$$;

-- ------------------- 5. CAIXA: vw_carteira + boletos_pagos -------------------
-- Reescreve a view acrescentando o termo boletos_pagos. Boleto pendente não
-- toca o caixa (forma BOLETO não está em saidas_avista); ao pagar, a parcela
-- vira PAGA e o valor entra aqui — a compra já contava na competência, então
-- não há duplicata.
create or replace view public.vw_carteira
with (security_invoker = true)
as
select
  coalesce((
    select sum(t.valor_total)
    from public.transacoes_origem t
    where t.tipo = 'RECEITA' and t.deleted_at is null
  ), 0)::bigint as entradas,
  coalesce((
    select sum(t.valor_total)
    from public.transacoes_origem t
    where t.tipo = 'DESPESA'
      and t.forma_pagamento in ('DEBITO', 'PIX', 'DINHEIRO')
      and t.deleted_at is null
  ), 0)::bigint as saidas_avista,
  coalesce((
    select sum(v.valor_total_fatura)
    from public.vw_faturas_consolidadas v
    where v.status = 'PAGA'
  ), 0)::bigint as faturas_pagas,
  (
    coalesce((
      select sum(t.valor_total)
      from public.transacoes_origem t
      where t.tipo = 'RECEITA' and t.deleted_at is null
    ), 0)
    - coalesce((
      select sum(t.valor_total)
      from public.transacoes_origem t
      where t.tipo = 'DESPESA'
        and t.forma_pagamento in ('DEBITO', 'PIX', 'DINHEIRO')
        and t.deleted_at is null
    ), 0)
    - coalesce((
      select sum(v.valor_total_fatura)
      from public.vw_faturas_consolidadas v
      where v.status = 'PAGA'
    ), 0)
    - coalesce((
      select sum(t.valor_total)
      from public.transacoes_origem t
      join public.parcelas p
        on p.transacao_id = t.id and p.deleted_at is null
      where t.forma_pagamento = 'BOLETO'
        and t.tipo = 'DESPESA'
        and t.deleted_at is null
        and p.status = 'PAGA'
    ), 0)
  )::bigint as saldo_caixa,
  -- Coluna nova vai por ÚLTIMO: create-or-replace de view exige superset
  -- anexado ao fim (colunas antigas preservam nome e ordem).
  coalesce((
    select sum(t.valor_total)
    from public.transacoes_origem t
    join public.parcelas p
      on p.transacao_id = t.id and p.deleted_at is null
    where t.forma_pagamento = 'BOLETO'
      and t.tipo = 'DESPESA'
      and t.deleted_at is null
      and p.status = 'PAGA'
  ), 0)::bigint as boletos_pagos;

revoke all on public.vw_carteira from public, anon;
grant select on public.vw_carteira to authenticated;

-- ------------------- 6. CONTAS A PAGAR: view unificada -------------------
-- Faturas de cartão não pagas ∪ boletos pendentes: uma lista só, com a mesma
-- semântica (obrigação com vencimento). O dashboard ordena por data_vencimento.
-- security_invoker: roda sob a RLS do usuário (as views/tabelas-base já filtram).
create or replace view public.vw_contas_a_pagar
with (security_invoker = true)
as
-- Faturas de cartão em aberto/fechadas com saldo devedor.
select
  'FATURA'::text                       as tipo,
  f.id                                 as origem_id,       -- id da fatura (pagar via processar_pagamento_fatura)
  null::uuid                           as transacao_id,
  coalesce(c.nome, 'Cartão')           as descricao,
  f.competencia                        as competencia,
  f.data_vencimento                    as data_vencimento,
  f.status                             as status,          -- ABERTA | FECHADA
  f.valor_total_fatura                 as valor
from public.vw_faturas_consolidadas f
left join public.cartoes_credito c on c.id = f.cartao_id
where f.status <> 'PAGA'
  and f.valor_total_fatura > 0
union all
-- Boletos pendentes (parcela única PENDENTE).
select
  'BOLETO'::text                       as tipo,
  t.id                                 as origem_id,
  t.id                                 as transacao_id,    -- pagar via pagar_boleto
  t.descricao                          as descricao,
  date_trunc('month', t.data_compra)::date as competencia,
  t.data_vencimento                    as data_vencimento,
  'A_PAGAR'::text                      as status,
  t.valor_total                        as valor
from public.transacoes_origem t
join public.parcelas p
  on p.transacao_id = t.id and p.deleted_at is null
where t.forma_pagamento = 'BOLETO'
  and t.tipo = 'DESPESA'
  and t.deleted_at is null
  and p.status = 'PENDENTE';

revoke all on public.vw_contas_a_pagar from public, anon;
grant select on public.vw_contas_a_pagar to authenticated;

-- ------------------- 7. PRIVILÉGIOS DAS RPCs -------------------
revoke execute on function public.criar_boleto(text, bigint, date, date, uuid) from public, anon;
revoke execute on function public.pagar_boleto(uuid, timestamptz) from public, anon;
revoke execute on function public.editar_boleto(uuid, text, bigint, date, date, uuid, boolean) from public, anon;
grant  execute on function public.criar_boleto(text, bigint, date, date, uuid) to authenticated;
grant  execute on function public.pagar_boleto(uuid, timestamptz) to authenticated;
grant  execute on function public.editar_boleto(uuid, text, bigint, date, date, uuid, boolean) to authenticated;
