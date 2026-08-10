-- =====================================================================
-- APLICAR_0011_0014.sql — BUNDLE consolidado para o Supabase real.
-- Cole TUDO no SQL Editor e rode uma vez. Idempotente (create or replace
-- / if not exists), pode reexecutar sem estragar dados.
-- Ordem: 0011 (substituir_transacao) -> 0012 (carteira) -> 0013 (boletos)
--        -> 0014 (estorno + recorrência + agendamento fechar_faturas).
-- Depois disso: Carteira, boletos, estorno e recorrência funcionam no app.
-- =====================================================================


-- >>>>>>>>>>>>>>>>>>>> migrations/0011_substituir_transacao.sql >>>>>>>>>>>>>>>>>>>>
-- =====================================================================
-- 0011_substituir_transacao.sql
-- Edição COMPLETA de transação: além de descrição/valor/data (0007), permite
-- trocar tipo (DESPESA/RECEITA), forma de pagamento (CREDITO/DEBITO/PIX/
-- DINHEIRO) e nº de parcelas. Mudar esses campos reestrutura parcelas e
-- faturas e repassa o guard de limite — refazê-los em código de edição
-- duplicaria toda a lógica de 0002. Em vez disso, SUBSTITUI atomicamente:
--   1. valida que a antiga pode sair (mesmos guards de 0007: sem parcela
--      PAGA, sem parcela em fatura FECHADA/PAGA);
--   2. soft-delete da antiga (trigger cascateia as parcelas e libera limite);
--   3. cria a nova via processar_transacao_completa (limite, faturas,
--      divisão centesimal — tudo reaproveitado e já testado);
--   4. aplica categoria explícita (senão o trigger 0008 autocategoriza).
-- Tudo na MESMA transação: se a criação falhar (ex.: FW429 limite), o
-- soft-delete reverte junto — nunca fica sem a transação original.
-- Padrões: DEFINER + search_path='' + escopo auth.uid() + FW4xx (CLAUDE.md).
-- =====================================================================
create or replace function public.substituir_transacao(
  p_transacao_id    uuid,
  p_descricao       text,
  p_valor_total     bigint,             -- centavos
  p_tipo            text,               -- DESPESA | RECEITA
  p_forma_pagamento text,               -- CREDITO | DEBITO | PIX | DINHEIRO
  p_cartao_id       uuid default null,
  p_data_compra     date default null,
  p_num_parcelas    int  default 1,
  p_categoria_id    uuid default null   -- null = deixa a regra decidir
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_old     public.transacoes_origem%rowtype;
  v_res     jsonb;
  v_new     uuid;
begin
  if v_user_id is null then
    raise exception 'Não autenticado.'
      using errcode = 'FW401', hint = 'Sessão ausente/expirada. Não retente; reautentique.';
  end if;
  if p_transacao_id is null then
    raise exception 'p_transacao_id é obrigatório.'
      using errcode = 'FW400', hint = 'Informe o uuid da transação.';
  end if;

  select * into v_old
  from public.transacoes_origem
  where id = p_transacao_id and user_id = v_user_id and deleted_at is null
  for update;
  if not found then
    raise exception 'Transação % não encontrada para este usuário.', p_transacao_id
      using errcode = 'FW404', hint = 'Confira o id; a transação pode estar excluída.';
  end if;

  -- Guards idênticos aos de 0007: histórico liquidado é imutável.
  if exists (select 1 from public.parcelas
             where transacao_id = v_old.id and user_id = v_user_id
               and status = 'PAGA' and deleted_at is null) then
    raise exception 'Transação % tem parcela PAGA — não pode ser alterada.', p_transacao_id
      using errcode = 'FW409', hint = 'Histórico pago não se edita; lance um estorno (RECEITA).';
  end if;
  if exists (select 1
             from public.parcelas p
             join public.faturas f on f.id = p.fatura_id
             where p.transacao_id = v_old.id and p.user_id = v_user_id
               and p.deleted_at is null and f.deleted_at is null
               and f.status <> 'ABERTA') then
    raise exception 'Transação % tem parcela em fatura FECHADA/PAGA.', p_transacao_id
      using errcode = 'FW409', hint = 'Ciclo fechado não reabre; estorne em vez de editar.';
  end if;

  -- Categoria explícita, se veio, precisa ser do usuário.
  if p_categoria_id is not null and not exists (
      select 1 from public.categorias
      where id = p_categoria_id and user_id = v_user_id and deleted_at is null) then
    raise exception 'Categoria % não encontrada para este usuário.', p_categoria_id
      using errcode = 'FW404', hint = 'Confira o id da categoria.';
  end if;

  -- 1) Soft-delete da antiga (trigger 0001 cascateia parcelas e, com elas,
  --    devolve o limite comprometido antes de recalcular na criação).
  update public.transacoes_origem set deleted_at = now() where id = v_old.id;

  -- 2) Cria a nova reusando o motor completo (valida forma/tipo/parcelas,
  --    limite, faturas, divisão centesimal). Qualquer RAISE aqui reverte o
  --    soft-delete acima (mesma transação).
  v_res := public.processar_transacao_completa(
    p_descricao, p_valor_total, p_tipo, p_forma_pagamento,
    p_cartao_id, p_data_compra, coalesce(p_num_parcelas, 1));
  v_new := (v_res->>'transacao_id')::uuid;

  -- 3) Categoria explícita prevalece sobre a autocategorização por regra.
  if p_categoria_id is not null then
    update public.transacoes_origem
       set categoria_id = p_categoria_id
     where id = v_new and user_id = v_user_id;
  end if;

  return jsonb_build_object(
    'transacao_id', v_new,
    'substituida',  v_old.id,
    'parcelas_criadas', v_res->'parcelas_criadas');
end;
$$;

revoke execute on function public.substituir_transacao(uuid, text, bigint, text, text, uuid, date, int, uuid) from public, anon;
grant  execute on function public.substituir_transacao(uuid, text, bigint, text, text, uuid, date, int, uuid) to authenticated;

-- >>>>>>>>>>>>>>>>>>>> migrations/0012_carteira_caixa.sql >>>>>>>>>>>>>>>>>>>>
-- =====================================================================
-- 0012_carteira_caixa.sql
-- Regime de CAIXA (carteira), complementar ao regime de COMPETÊNCIA já
-- existente. Resolve a confusão do cartão de crédito:
--
--   * Compra no crédito é DESPESA na competência (aparece em "onde gasto"),
--     e vira parcelas em faturas futuras. Ela NÃO sai do caixa na hora.
--   * Pagar a fatura é a saída de caixa que quita o cartão — NÃO é uma nova
--     despesa (contá-la de novo duplicaria a compra parcelada). Por isso o
--     app nunca cria transação ao pagar (0003 só marca PAGA); a carteira
--     apenas subtrai o total das faturas pagas.
--
--   Carteira (saldo de caixa) = receitas
--                             − despesas à vista (DEBITO/PIX/DINHEIRO)
--                             − faturas pagas (total consolidado).
--   Compras no crédito entram no caixa só quando a fatura é paga => sem
--   duplicata entre "a compra parcelada" e "o pagamento da fatura".
--
-- security_invoker = true (obrigatório): a view roda com a RLS do usuário,
-- então cada um vê só o próprio caixa (senão vazaria entre usuários).
-- Sem FROM: os agregados são subqueries escalares filtradas pela RLS das
-- tabelas-base; retorna sempre uma linha (zeros quando não há dados).
-- =====================================================================
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
  )::bigint as saldo_caixa;

revoke all on public.vw_carteira from public, anon;
grant select on public.vw_carteira to authenticated;

-- >>>>>>>>>>>>>>>>>>>> migrations/0013_boletos.sql >>>>>>>>>>>>>>>>>>>>
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

-- >>>>>>>>>>>>>>>>>>>> migrations/0014_estorno_recorrencia_cron.sql >>>>>>>>>>>>>>>>>>>>
-- =====================================================================
-- 0014_estorno_recorrencia_cron.sql
-- Fecha três lacunas de PROCESSO apontadas na auditoria:
--
--   P1  fechar_faturas existe (0006) mas nada a agenda: em produção as
--       faturas ficam eternamente ABERTA. Aqui agendamos no pg_cron (diário).
--       O bloco é GUARDADO por disponibilidade da extensão — no Postgres de
--       teste (sem pg_cron) ele é ignorado; no Supabase ele agenda.
--
--   P2  "Desfazer pagamento": pagar fatura/boleto por engano não tinha
--       estorno de 1 clique. estornar_pagamento_fatura e estornar_boleto são
--       simétricos a processar_pagamento_fatura (0003) e pagar_boleto (0013).
--
--   P2  Recorrência de boleto: gasto fixo mensal (luz/água) era relançado à
--       mão. duplicar_boleto clona o boleto para o(s) mês(es) seguinte(s) —
--       o "relançar mês que vem" de 1 clique (caminho mínimo; série completa
--       fica para depois).
--
-- Padrões do projeto: RPC SECURITY DEFINER + search_path='' + escopo
-- auth.uid() em toda query + FW4xx com hint. DML direto continua revogado.
-- =====================================================================

-- ------------------- 1. ESTORNO DE PAGAMENTO DE FATURA -------------------
-- Simétrico a processar_pagamento_fatura: PAGA -> volta ao estado de ciclo
-- (ABERTA/FECHADA) que a fatura teria HOJE, e as parcelas voltam a PENDENTE.
-- Reconstrói o status pelo mesmo corte de fechar_faturas (0006) porque o
-- estado anterior (ABERTA vs FECHADA) não é persistido: recomputar é correto,
-- reverter cego para ABERTA mentiria numa fatura já vencida.
create or replace function public.estornar_pagamento_fatura(
  p_fatura_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id     uuid := auth.uid();
  v_fatura      public.faturas%rowtype;
  v_fechamento  int;
  v_corte       date;
  v_novo_status text;
  v_estornadas  int;
begin
  if v_user_id is null then
    raise exception 'Não autenticado.'
      using errcode = 'FW401', hint = 'Sessão ausente/expirada. Não retente; reautentique.';
  end if;
  if p_fatura_id is null then
    raise exception 'p_fatura_id é obrigatório.'
      using errcode = 'FW400', hint = 'Informe o uuid da fatura.';
  end if;

  select * into v_fatura
  from public.faturas
  where id = p_fatura_id and user_id = v_user_id and deleted_at is null
  for update;
  if not found then
    raise exception 'Fatura % não encontrada para este usuário.', p_fatura_id
      using errcode = 'FW404', hint = 'Confira o id; a fatura pode estar soft-deletada.';
  end if;
  if v_fatura.status <> 'PAGA' then
    raise exception 'Fatura % não está PAGA — nada a estornar.', p_fatura_id
      using errcode = 'FW409', hint = 'Só faturas PAGAS podem ser estornadas.';
  end if;

  -- Corte da competência = dia de fechamento clampado ao último dia do mês
  -- (mesma conta de fechar_faturas). Fatura cujo corte já passou = FECHADA.
  select least(c.dia_fechamento,
               extract(day from (v_fatura.competencia + interval '1 month - 1 day'))::int)
    into v_fechamento
  from public.cartoes_credito c
  where c.id = v_fatura.cartao_id;

  v_corte := (v_fatura.competencia + (coalesce(v_fechamento, 1) - 1) * interval '1 day')::date;
  v_novo_status := case
    when v_corte <= (now() at time zone 'America/Sao_Paulo')::date then 'FECHADA'
    else 'ABERTA'
  end;

  update public.faturas
     set status = v_novo_status, updated_at = now()
   where id = v_fatura.id;

  update public.parcelas
     set status = 'PENDENTE',
         data_pagamento = null,
         updated_at = now()
   where fatura_id = v_fatura.id
     and user_id = v_user_id
     and deleted_at is null
     and status = 'PAGA';
  get diagnostics v_estornadas = row_count;

  return jsonb_build_object(
    'fatura_id',          v_fatura.id,
    'status',             v_novo_status,
    'parcelas_estornadas', v_estornadas);
end;
$$;

-- ------------------- 2. ESTORNO DE PAGAMENTO DE BOLETO -------------------
-- Simétrico a pagar_boleto (0013): PAGA -> PENDENTE, some data_pagamento.
-- O valor volta para vw_carteira (sai de boletos_pagos) e o boleto reaparece
-- em vw_contas_a_pagar.
create or replace function public.estornar_boleto(
  p_transacao_id uuid
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

  select * into v_t
  from public.transacoes_origem
  where id = p_transacao_id and user_id = v_user_id and deleted_at is null
    and forma_pagamento = 'BOLETO'
  for update;
  if not found then
    raise exception 'Boleto % não encontrado para este usuário.', p_transacao_id
      using errcode = 'FW404', hint = 'Confira o id; o boleto pode estar excluído ou não ser BOLETO.';
  end if;

  select * into v_parcela
  from public.parcelas
  where transacao_id = v_t.id and user_id = v_user_id and deleted_at is null
  for update;
  if not found then
    raise exception 'Boleto % sem parcela ativa.', p_transacao_id
      using errcode = 'FW500', hint = 'Falha interna; reporte com a mensagem completa.';
  end if;
  if v_parcela.status <> 'PAGA' then
    raise exception 'Boleto % não está PAGO — nada a estornar.', p_transacao_id
      using errcode = 'FW409', hint = 'Só boletos PAGOS podem ser estornados.';
  end if;

  update public.parcelas
     set status = 'PENDENTE', data_pagamento = null
   where id = v_parcela.id;

  return jsonb_build_object(
    'transacao_id', v_t.id,
    'status',       'A_PAGAR');
end;
$$;

-- ------------------- 3. RECORRÊNCIA: duplicar_boleto -------------------
-- Clona um boleto para +N meses (vencimento e competência avançam N meses,
-- valor/descrição/categoria copiados). Novo boleto nasce PENDENTE. É o
-- "relançar a conta de luz do mês que vem" de 1 clique. Boleto PAGO também
-- pode ser duplicado (o pago é histórico; o clone é a próxima conta).
create or replace function public.duplicar_boleto(
  p_transacao_id uuid,
  p_meses        int default 1   -- quantos meses à frente (1 = próximo mês)
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id      uuid := auth.uid();
  v_src          public.transacoes_origem%rowtype;
  v_venc         date;
  v_comp         date;
  v_novo_id      uuid;
begin
  if v_user_id is null then
    raise exception 'Não autenticado.'
      using errcode = 'FW401', hint = 'Sessão ausente/expirada. Não retente; reautentique.';
  end if;
  if p_transacao_id is null then
    raise exception 'p_transacao_id é obrigatório.'
      using errcode = 'FW400', hint = 'Informe o uuid do boleto de origem.';
  end if;
  if p_meses is null or p_meses < 1 or p_meses > 12 then
    raise exception 'p_meses deve estar entre 1 e 12. Recebido: %', p_meses
      using errcode = 'FW400', hint = 'Use um deslocamento de 1 a 12 meses.';
  end if;

  select * into v_src
  from public.transacoes_origem
  where id = p_transacao_id and user_id = v_user_id and deleted_at is null
    and forma_pagamento = 'BOLETO'
  for update;
  if not found then
    raise exception 'Boleto % não encontrado para este usuário.', p_transacao_id
      using errcode = 'FW404', hint = 'Confira o id; o boleto pode estar excluído ou não ser BOLETO.';
  end if;

  v_venc := (v_src.data_vencimento + (p_meses || ' months')::interval)::date;
  v_comp := (v_src.data_compra     + (p_meses || ' months')::interval)::date;

  -- Mesma janela de plausibilidade de criar_boleto (0013): +5 anos venc,
  -- +1 ano competência. Deslocar 12 meses não estoura, mas guardamos igual.
  if v_venc > (now() at time zone 'America/Sao_Paulo')::date + interval '5 years' then
    raise exception 'vencimento do clone fora do intervalo plausível: %', v_venc
      using errcode = 'FW400', hint = 'Reduza o deslocamento de meses.';
  end if;
  if v_comp > (now() at time zone 'America/Sao_Paulo')::date + interval '1 year' then
    raise exception 'competência do clone fora do intervalo plausível: %', v_comp
      using errcode = 'FW400', hint = 'Reduza o deslocamento de meses.';
  end if;

  insert into public.transacoes_origem
    (user_id, descricao, valor_total, tipo, forma_pagamento, cartao_id,
     data_compra, num_parcelas, data_vencimento, categoria_id)
  values
    (v_user_id, v_src.descricao, v_src.valor_total, 'DESPESA', 'BOLETO', null,
     v_comp, 1, v_venc, v_src.categoria_id)  -- categoria copiada; trigger só age se null
  returning id into v_novo_id;

  insert into public.parcelas
    (user_id, transacao_id, fatura_id, numero, valor, data_competencia)
  values
    (v_user_id, v_novo_id, null, 1, v_src.valor_total, v_comp);

  return jsonb_build_object(
    'transacao_id',    v_novo_id,
    'data_vencimento', v_venc,
    'competencia',     v_comp,
    'status',          'A_PAGAR');
end;
$$;

-- ------------------- 4. PRIVILÉGIOS DAS RPCs -------------------
revoke execute on function public.estornar_pagamento_fatura(uuid) from public, anon;
revoke execute on function public.estornar_boleto(uuid)           from public, anon;
revoke execute on function public.duplicar_boleto(uuid, int)      from public, anon;
grant  execute on function public.estornar_pagamento_fatura(uuid) to authenticated;
grant  execute on function public.estornar_boleto(uuid)           to authenticated;
grant  execute on function public.duplicar_boleto(uuid, int)      to authenticated;

-- ------------------- 5. AGENDAMENTO DIÁRIO DE fechar_faturas (P1) -------------------
-- fechar_faturas (0006) é administrativa (fecha TODOS os usuários) e não pode
-- ser chamada por cliente. pg_cron a roda como owner (postgres/superuser), que
-- tem execute. Cron do Supabase usa UTC: 06:10 UTC ≈ 03:10 America/Sao_Paulo.
--
-- Bloco guardado: só executa onde pg_cron está DISPONÍVEL (Supabase). No
-- Postgres da suite local a extensão não existe -> o if é falso e nada roda,
-- então as migrações continuam aplicáveis em qualquer ambiente. execute
-- dinâmico evita qualquer dependência de parse do schema `cron`.
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    execute 'create extension if not exists pg_cron';
    -- Remove agendamento anterior (idempotente): sem linha em cron.job, o
    -- select não chama unschedule e não há erro "job not found".
    execute $q$
      select cron.unschedule(jobid)
      from cron.job
      where jobname = 'fechar-faturas-diario'
    $q$;
    execute $q$
      select cron.schedule(
        'fechar-faturas-diario',
        '10 6 * * *',
        'select public.fechar_faturas();'
      )
    $q$;
  end if;
end $$;
