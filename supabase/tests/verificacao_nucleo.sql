-- =====================================================================
-- verificacao_nucleo.sql — executar no SQL Editor. Não persiste nada.
-- Simula um usuário autenticado para exercitar RLS + RPC de ponta a ponta.
-- =====================================================================
begin;

insert into auth.users (id, email)
values ('00000000-0000-0000-0000-0000000000aa', 'teste@local.dev')
on conflict (id) do nothing;

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000000aa","role":"authenticated"}', true);
set local role authenticated;

do $$
declare
  v_cartao uuid;
  v_res    jsonb;
  v_vals   bigint[];
  v_venc   date;
  v_qtd    int;
  v_fatura uuid;
begin
  insert into public.cartoes_credito (user_id, nome, limite_total, dia_fechamento, dia_vencimento)
  values (auth.uid(), 'Teste 31/31', 1000000, 31, 31)
  returning id into v_cartao;

  -- [1] Divisão centesimal: R$100,00 em 3x => 3334 + 3333 + 3333 = 10000
  v_res := public.processar_transacao_completa(
    'Compra 3x', 10000, 'DESPESA', 'CREDITO', v_cartao, date '2026-01-15', 3);
  select array_agg(valor order by numero) into v_vals
  from public.parcelas where transacao_id = (v_res->>'transacao_id')::uuid;
  if v_vals <> array[3334,3333,3333]::bigint[] then
    raise exception 'FALHA [1]: parcelas = %', v_vals;
  end if;

  -- [2] Falha do Dia 31: fatura jan/2026 (vencimento dia 31) vence em 28/02/2026
  select data_vencimento into v_venc
  from public.faturas where cartao_id = v_cartao and competencia = date '2026-01-01';
  if v_venc <> date '2026-02-28' then
    raise exception 'FALHA [2]: vencimento = % (esperado 2026-02-28)', v_venc;
  end if;

  -- [3] Corte do fechamento: compra em 31/01 cai na competência de fevereiro
  v_res := public.processar_transacao_completa(
    'Compra no fechamento', 5000, 'DESPESA', 'CREDITO', v_cartao, date '2026-01-31', 1);
  if not exists (select 1 from public.parcelas
                 where transacao_id = (v_res->>'transacao_id')::uuid
                   and data_competencia = date '2026-02-01') then
    raise exception 'FALHA [3]: competência errada para compra no dia do fechamento';
  end if;

  -- [4] Idempotência: 2 transações tocando fev/2026 => exatamente 1 fatura
  select count(*) into v_qtd
  from public.faturas where cartao_id = v_cartao and competencia = date '2026-02-01';
  if v_qtd <> 1 then
    raise exception 'FALHA [4]: % faturas para fev/2026', v_qtd;
  end if;

  -- [5] Não-CREDITO: parcela única sem fatura
  v_res := public.processar_transacao_completa(
    'Pix mercado', 4321, 'DESPESA', 'PIX', null, date '2026-01-10', 1);
  if not exists (select 1 from public.parcelas
                 where transacao_id = (v_res->>'transacao_id')::uuid
                   and fatura_id is null and valor = 4321) then
    raise exception 'FALHA [5]: fluxo não-CREDITO incorreto';
  end if;

  -- [6] Limite de crédito: pendente = 15000 (10000 + 5000); 990000 estoura
  --     o limite de 1000000 => FW429. RAISE default (P0001) não é capturado.
  begin
    perform public.processar_transacao_completa(
      'Estouro de limite', 990000, 'DESPESA', 'CREDITO', v_cartao, date '2026-01-15', 1);
    raise exception 'FALHA [6]: limite excedido não foi bloqueado';
  exception
    when sqlstate 'FW429' then null; -- esperado
  end;

  -- [7] Pagamento de fatura: jan/2026 vira PAGA e baixa as parcelas filhas
  select id into v_fatura
  from public.faturas where cartao_id = v_cartao and competencia = date '2026-01-01';
  v_res := public.processar_pagamento_fatura(v_fatura, timestamptz '2026-02-28 10:00-03');
  if (select status from public.faturas where id = v_fatura) <> 'PAGA' then
    raise exception 'FALHA [7]: fatura não transicionou para PAGA';
  end if;
  if exists (select 1 from public.parcelas
             where fatura_id = v_fatura and deleted_at is null
               and (status <> 'PAGA' or data_pagamento is null)) then
    raise exception 'FALHA [7]: parcelas da fatura não foram baixadas';
  end if;

  -- [8] Idempotência dura: pagar fatura já PAGA => FW409
  begin
    perform public.processar_pagamento_fatura(v_fatura, now());
    raise exception 'FALHA [8]: repagamento de fatura PAGA não foi bloqueado';
  exception
    when sqlstate 'FW409' then null; -- esperado
  end;

  -- [9] Soft delete não trava competência: fatura mar/2026 deletada, nova
  --     compra 2x tocando março recria fatura ativa (índice parcial de 0004)
  update public.faturas set deleted_at = now()
  where cartao_id = v_cartao and competencia = date '2026-03-01';
  v_res := public.processar_transacao_completa(
    'Pós soft-delete', 2000, 'DESPESA', 'CREDITO', v_cartao, date '2026-02-15', 2);
  if (v_res->>'parcelas_criadas')::int <> 2 then
    raise exception 'FALHA [9]: % parcelas criadas (esperado 2)', v_res->>'parcelas_criadas';
  end if;
  select count(*) into v_qtd
  from public.faturas
  where cartao_id = v_cartao and competencia = date '2026-03-01' and deleted_at is null;
  if v_qtd <> 1 then
    raise exception 'FALHA [9]: % faturas ativas para mar/2026 (esperado 1)', v_qtd;
  end if;

  raise notice 'OK: 9/9 asserts do núcleo transacional passaram.';
end $$;

rollback;
