-- =====================================================================
-- verificacao_isolamento.sql — executar no SQL Editor. Não persiste nada.
-- Fecha os achados #3 (MEDIUM) e #8 (INFO) da auditoria: prova, de forma
-- DEDICADA e nomeada, que um usuário B não enxerga nem consegue operar
-- recursos do usuário A. As suítes existentes só provavam isolamento de
-- forma indireta (agregados de saldo bateriam errado se vazasse). Aqui a
-- garantia é uma asserção explícita — resiliente a mudanças futuras.
-- =====================================================================
begin;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000aa', 'usuario-a@local.dev'),
  ('00000000-0000-0000-0000-0000000000bb', 'usuario-b@local.dev')
on conflict (id) do nothing;

-- ---------------------------------------------------------------------
-- Sessão do usuário A: cria um cartão e uma transação parcelada.
-- ---------------------------------------------------------------------
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000000aa","role":"authenticated"}', true);
set local role authenticated;

do $$
declare
  v_cartao uuid;
  v_res    jsonb;
  v_txn    uuid;
begin
  v_res := public.criar_cartao('Cartao do A', 500000, 10, 20);
  v_cartao := (v_res->>'cartao_id')::uuid;

  v_res := public.processar_transacao_completa(
    'Compra do A', 15000, 'DESPESA', 'CREDITO', v_cartao, date '2026-03-05', 3);
  v_txn := (v_res->>'transacao_id')::uuid;

  -- Passa os ids de A para a sessão de B via GUC transaction-scoped.
  perform set_config('teste.cartao_a', v_cartao::text, true);
  perform set_config('teste.transacao_a', v_txn::text, true);

  -- Sanidade: A enxerga o próprio cartão (RLS não é restritiva demais).
  if (select count(*) from public.cartoes_credito where id = v_cartao) <> 1 then
    raise exception 'FALHA [ISO-setup]: A nao enxerga o proprio cartao';
  end if;
end $$;

reset role;

-- ---------------------------------------------------------------------
-- Sessão do usuário B: não deve VER nem TOCAR nada de A.
-- ---------------------------------------------------------------------
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000000bb","role":"authenticated"}', true);
set local role authenticated;

do $$
declare
  v_cartao_a uuid := current_setting('teste.cartao_a')::uuid;
  v_txn_a    uuid := current_setting('teste.transacao_a')::uuid;
  v_ok       boolean := false;
begin
  -- [ISO-1] B não enxerga NENHUMA linha de A sob a RLS.
  if (select count(*) from public.cartoes_credito where id = v_cartao_a) <> 0 then
    raise exception 'FALHA [ISO-1a]: B enxerga o cartao de A';
  end if;
  if (select count(*) from public.transacoes_origem where id = v_txn_a) <> 0 then
    raise exception 'FALHA [ISO-1b]: B enxerga a transacao de A';
  end if;
  if (select count(*) from public.parcelas where transacao_id = v_txn_a) <> 0 then
    raise exception 'FALHA [ISO-1c]: B enxerga as parcelas de A';
  end if;

  -- [ISO-2] B não consegue usar o cartão de A numa RPC de escrita.
  -- A RPC resolve o cartão como `where id = p_cartao and user_id = auth.uid()`;
  -- sob B, não encontra e deve levantar FW404 — não vazar nem escrever.
  begin
    perform public.processar_transacao_completa(
      'Ataque de B ao cartao de A', 1000, 'DESPESA', 'CREDITO',
      v_cartao_a, date '2026-03-10', 1);
  exception
    when sqlstate 'FW404' then
      v_ok := true; -- comportamento esperado
    when others then
      raise exception 'FALHA [ISO-2]: esperado FW404, veio % (%)', sqlstate, sqlerrm;
  end;
  if not v_ok then
    raise exception 'FALHA [ISO-2]: RPC aceitou o cartao de outro usuario (vazamento de escopo)';
  end if;

  raise notice 'OK: 5/5 asserts (isolamento cross-tenant: ISO-setup, ISO-1a/b/c, ISO-2).';
end $$;

reset role;
rollback;
