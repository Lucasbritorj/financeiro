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

  raise notice 'OK: 5/5 asserts do núcleo transacional passaram.';
end $$;

rollback;
