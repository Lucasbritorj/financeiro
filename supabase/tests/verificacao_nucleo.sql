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
  v_total  bigint;
  v_upd_antes timestamptz;
  v_cartao2   uuid;
begin
  -- Pós-0005 o INSERT direto é negado: cartão nasce pela RPC, como no app.
  v_res := public.criar_cartao('Teste 31/31', 1000000, 31, 31);
  v_cartao := (v_res->>'cartao_id')::uuid;

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
  --     compra 2x tocando março recria fatura ativa (índice parcial de 0004).
  --     UPDATE direto é negado a authenticated (0005): a exclusão lógica de
  --     fatura ainda não tem RPC, então o teste troca para a role da sessão.
  reset role;
  update public.faturas set deleted_at = now()
  where cartao_id = v_cartao and competencia = date '2026-03-01';
  set local role authenticated;
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

  -- [10] Trava de fatura liquidada: jan/2026 está PAGA ([7]); nova compra
  --      na mesma competência => FW409 (fail fast, sem escrita parcial)
  begin
    perform public.processar_transacao_completa(
      'Compra pós-pagamento', 1000, 'DESPESA', 'CREDITO', v_cartao, date '2026-01-15', 1);
    raise exception 'FALHA [10]: compra em fatura PAGA não foi travada';
  exception
    when sqlstate 'FW409' then null; -- esperado
  end;

  -- [11] Teto de parcelas no servidor: 121 => FW400
  begin
    perform public.processar_transacao_completa(
      'Parcelas demais', 500000, 'DESPESA', 'CREDITO', v_cartao, date '2026-04-10', 121);
    raise exception 'FALHA [11]: teto de 120 parcelas não aplicado';
  exception
    when sqlstate 'FW400' then null; -- esperado
  end;

  -- [12] Camada semântica: despesa 10000 + estorno 3000 em abr/2026 =>
  --      vw_faturas_consolidadas fecha em 7000 (RECEITA abate)
  perform public.processar_transacao_completa(
    'Compra abril', 10000, 'DESPESA', 'CREDITO', v_cartao, date '2026-04-10', 1);
  perform public.processar_transacao_completa(
    'Estorno abril', 3000, 'RECEITA', 'CREDITO', v_cartao, date '2026-04-10', 1);
  select valor_total_fatura into v_total
  from public.vw_faturas_consolidadas
  where cartao_id = v_cartao and competencia = date '2026-04-01';
  if v_total is distinct from 7000 then
    raise exception 'FALHA [12]: view consolidou % (esperado 7000)', v_total;
  end if;

  -- [13] Least privilege: INSERT direto como authenticated => negado (42501)
  begin
    insert into public.transacoes_origem
      (user_id, descricao, valor_total, tipo, forma_pagamento, data_compra)
    values (auth.uid(), 'bypass', 100, 'DESPESA', 'PIX', date '2026-01-01');
    raise exception 'FALHA [13]: INSERT direto não foi negado';
  exception
    when insufficient_privilege then null; -- esperado
  end;

  -- [14] Erro classificado: cartão inexistente => FW404
  begin
    perform public.processar_transacao_completa(
      'Cartão fantasma', 1000, 'DESPESA', 'CREDITO', gen_random_uuid(), date '2026-04-10', 1);
    raise exception 'FALHA [14]: cartão inexistente não retornou FW404';
  exception
    when sqlstate 'FW404' then null; -- esperado
  end;

  -- [15] Sanidade temporal da compra: teto (ano 3000) e piso (< 2000) => FW400
  begin
    perform public.processar_transacao_completa(
      'Compra no futuro', 1000, 'DESPESA', 'PIX', null, date '3000-01-01', 1);
    raise exception 'FALHA [15]: data de compra absurda foi aceita';
  exception
    when sqlstate 'FW400' then null; -- esperado
  end;
  begin
    perform public.processar_transacao_completa(
      'Compra no passado remoto', 1000, 'DESPESA', 'PIX', null, date '1999-12-31', 1);
    raise exception 'FALHA [15]: data de compra anterior a 2000 foi aceita';
  exception
    when sqlstate 'FW400' then null; -- esperado
  end;

  -- [16] Sanidade temporal do pagamento: futuro e passado remoto => FW400
  select id into v_fatura
  from public.faturas
  where cartao_id = v_cartao and competencia = date '2026-02-01';
  begin
    perform public.processar_pagamento_fatura(v_fatura, now() + interval '30 days');
    raise exception 'FALHA [16]: data de pagamento futura foi aceita';
  exception
    when sqlstate 'FW400' then null; -- esperado
  end;
  begin
    perform public.processar_pagamento_fatura(v_fatura, timestamptz '1999-12-31 00:00Z');
    raise exception 'FALHA [16]: data de pagamento anterior a 2000 foi aceita';
  exception
    when sqlstate 'FW400' then null; -- esperado
  end;

  -- [17] Regressão de privilégios: authenticated não pode ter DML direto
  if has_table_privilege('authenticated', 'public.cartoes_credito', 'INSERT,UPDATE,DELETE')
     or has_table_privilege('authenticated', 'public.faturas', 'INSERT,UPDATE,DELETE')
     or has_table_privilege('authenticated', 'public.transacoes_origem', 'INSERT,UPDATE,DELETE')
     or has_table_privilege('authenticated', 'public.parcelas', 'INSERT,UPDATE,DELETE') then
    raise exception 'FALHA [17]: authenticated recuperou DML direto em alguma tabela';
  end if;

  -- [18] Exclusão soft de transação: cascata via trigger e updated_at tocado
  v_res := public.processar_transacao_completa(
    'Compra a excluir', 2000, 'DESPESA', 'CREDITO', v_cartao, date '2026-04-15', 2);
  select updated_at into v_upd_antes
  from public.transacoes_origem where id = (v_res->>'transacao_id')::uuid;
  v_res := public.excluir_transacao((v_res->>'transacao_id')::uuid);
  if (v_res->>'parcelas_afetadas')::int <> 2 then
    raise exception 'FALHA [18]: cascata reportou % parcelas (esperado 2)', v_res->>'parcelas_afetadas';
  end if;
  if exists (select 1 from public.parcelas
             where transacao_id = (v_res->>'transacao_id')::uuid and deleted_at is null) then
    raise exception 'FALHA [18]: parcelas seguiram ativas após exclusão da transação';
  end if;
  -- Linhas soft-deletadas são invisíveis sob RLS: verificação como admin.
  -- trg_touch_updated_at usa clock_timestamp(), que avança dentro da transação.
  reset role;
  if not exists (select 1 from public.transacoes_origem
                 where id = (v_res->>'transacao_id')::uuid
                   and deleted_at is not null
                   and updated_at > v_upd_antes) then
    raise exception 'FALHA [18]: updated_at da transação não avançou na exclusão';
  end if;
  if exists (select 1 from public.parcelas
             where transacao_id = (v_res->>'transacao_id')::uuid
               and (deleted_at is null or updated_at <= v_upd_antes)) then
    raise exception 'FALHA [18]: updated_at de parcela cascateada não avançou';
  end if;
  set local role authenticated;

  -- [19] Transação com parcela PAGA não se exclui, se estorna => FW409
  begin
    perform public.excluir_transacao(
      (select transacao_id from public.parcelas
       where status = 'PAGA' and user_id = auth.uid() limit 1));
    raise exception 'FALHA [19]: transação com parcela paga foi excluída';
  exception
    when sqlstate 'FW409' then null; -- esperado
  end;

  -- [20] Cartão com parcelas pendentes não sai => FW409; cartão limpo sai
  begin
    perform public.excluir_cartao(v_cartao);
    raise exception 'FALHA [20]: cartão com pendências foi excluído';
  exception
    when sqlstate 'FW409' then null; -- esperado
  end;
  v_res := public.criar_cartao('Temporário', 100000, 10, 20);
  v_res := public.excluir_cartao((v_res->>'cartao_id')::uuid);
  -- Sob RLS, cartão soft-deletado fica invisível — visibilidade = falha.
  if exists (select 1 from public.cartoes_credito
             where id = (v_res->>'cartao_id')::uuid) then
    raise exception 'FALHA [20]: cartão sem pendências continua visível (não foi soft-deletado)';
  end if;

  -- [21] Fechamento de ciclo: em 01/03/2026, fev (fecha 28/02) vira FECHADA;
  --      mar (fecha 31/03) segue ABERTA; fatura soft-deletada com corte
  --      vencido NÃO fecha. Função é administrativa: roda fora da role
  --      authenticated (pg_cron/painel).
  v_res := public.criar_cartao('Cartão fechamento', 100000, 10, 20);
  v_cartao2 := (v_res->>'cartao_id')::uuid;
  perform public.processar_transacao_completa(
    'Compra p/ fatura deletada', 1000, 'DESPESA', 'CREDITO', v_cartao2, date '2026-02-05', 1);
  reset role;
  update public.faturas set deleted_at = now()
  where cartao_id = v_cartao2 and competencia = date '2026-02-01';
  v_qtd := public.fechar_faturas(date '2026-03-01');
  if v_qtd < 1 then
    raise exception 'FALHA [21]: fechar_faturas não fechou nenhuma fatura';
  end if;
  if (select status from public.faturas
      where cartao_id = v_cartao2 and competencia = date '2026-02-01') <> 'ABERTA' then
    raise exception 'FALHA [21]: fatura soft-deletada foi fechada';
  end if;
  set local role authenticated;
  if (select status from public.faturas
      where cartao_id = v_cartao and competencia = date '2026-02-01') <> 'FECHADA' then
    raise exception 'FALHA [21]: fatura fev/2026 não fechou';
  end if;
  if (select status from public.faturas
      where cartao_id = v_cartao and competencia = date '2026-03-01' and deleted_at is null) <> 'ABERTA' then
    raise exception 'FALHA [21]: fatura mar/2026 fechou antes da hora';
  end if;

  raise notice 'OK: 21/21 asserts do núcleo transacional passaram.';
end $$;

rollback;
