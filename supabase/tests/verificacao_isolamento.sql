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
  v_categoria uuid;
  v_regra     uuid;
  v_importacao uuid;
  v_linha      uuid;
  v_cofrinho   uuid;
  v_movimentacao uuid;
  v_recorrencia  uuid;
begin
  v_res := public.criar_cartao('Cartao do A', 500000, 10, 20);
  v_cartao := (v_res->>'cartao_id')::uuid;

  v_res := public.processar_transacao_completa(
    'Compra do A', 15000, 'DESPESA', 'CREDITO', v_cartao, date '2026-03-05', 3);
  v_txn := (v_res->>'transacao_id')::uuid;

  -- Recursos das 7 tabelas mais novas (0008-0015), mesma policy de RLS das
  -- 4 acima mas sem assert direto até aqui (achado S-02 da auditoria
  -- graph-loop 2026-07-27 — a lacuna que deixou S-01/S-04 sobreviverem).
  v_categoria := (public.criar_categoria('Categoria do A', null, null, 'DESPESA')->>'categoria_id')::uuid;
  v_regra := (public.criar_regra_categorizacao('PADRAO_A', v_categoria, 50)->>'regra_id')::uuid;

  v_res := public.criar_importacao('CSV', jsonb_build_array(
    jsonb_build_object('data','2026-03-01','valor',-1000,'descricao','Linha do A')));
  v_importacao := (v_res->>'importacao_id')::uuid;
  select id into v_linha from public.importacao_linhas where importacao_id = v_importacao limit 1;

  v_cofrinho := (public.criar_cofrinho('Cofrinho do A', 100000, 'CURTO')->>'cofrinho_id')::uuid;
  perform public.aportar_cofrinho(v_cofrinho, 5000);
  select id into v_movimentacao from public.movimentacoes_cofrinho where cofrinho_id = v_cofrinho limit 1;

  v_recorrencia := (public.criar_recorrencia('Recorrencia do A', 3000, 'DESPESA', 'PIX', 5)->>'recorrencia_id')::uuid;

  -- Passa os ids de A para a sessão de B via GUC transaction-scoped.
  perform set_config('teste.cartao_a', v_cartao::text, true);
  perform set_config('teste.transacao_a', v_txn::text, true);
  perform set_config('teste.categoria_a', v_categoria::text, true);
  perform set_config('teste.regra_a', v_regra::text, true);
  perform set_config('teste.importacao_a', v_importacao::text, true);
  perform set_config('teste.linha_a', v_linha::text, true);
  perform set_config('teste.cofrinho_a', v_cofrinho::text, true);
  perform set_config('teste.movimentacao_a', v_movimentacao::text, true);
  perform set_config('teste.recorrencia_a', v_recorrencia::text, true);

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
  v_categoria_a     uuid := current_setting('teste.categoria_a')::uuid;
  v_regra_a         uuid := current_setting('teste.regra_a')::uuid;
  v_importacao_a    uuid := current_setting('teste.importacao_a')::uuid;
  v_linha_a         uuid := current_setting('teste.linha_a')::uuid;
  v_cofrinho_a      uuid := current_setting('teste.cofrinho_a')::uuid;
  v_movimentacao_a  uuid := current_setting('teste.movimentacao_a')::uuid;
  v_recorrencia_a   uuid := current_setting('teste.recorrencia_a')::uuid;
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

  -- [ISO-3] categorias: B não vê a categoria de A e editar_categoria => FW404.
  if (select count(*) from public.categorias where id = v_categoria_a) <> 0 then
    raise exception 'FALHA [ISO-3a]: B enxerga a categoria de A';
  end if;
  v_ok := false;
  begin
    perform public.editar_categoria(v_categoria_a, 'Hackeado por B');
  exception
    when sqlstate 'FW404' then v_ok := true;
    when others then raise exception 'FALHA [ISO-3b]: esperado FW404, veio % (%)', sqlstate, sqlerrm;
  end;
  if not v_ok then
    raise exception 'FALHA [ISO-3b]: editar_categoria aceitou a categoria de outro usuario';
  end if;

  -- [ISO-4] regras_categorizacao: B não vê a regra de A e excluir_regra_categorizacao => FW404.
  if (select count(*) from public.regras_categorizacao where id = v_regra_a) <> 0 then
    raise exception 'FALHA [ISO-4a]: B enxerga a regra de categorizacao de A';
  end if;
  v_ok := false;
  begin
    perform public.excluir_regra_categorizacao(v_regra_a);
  exception
    when sqlstate 'FW404' then v_ok := true;
    when others then raise exception 'FALHA [ISO-4b]: esperado FW404, veio % (%)', sqlstate, sqlerrm;
  end;
  if not v_ok then
    raise exception 'FALHA [ISO-4b]: excluir_regra_categorizacao aceitou a regra de outro usuario';
  end if;

  -- [ISO-5] importacoes: B não vê a importação de A e descartar_importacao => FW404.
  if (select count(*) from public.importacoes where id = v_importacao_a) <> 0 then
    raise exception 'FALHA [ISO-5a]: B enxerga a importacao de A';
  end if;
  v_ok := false;
  begin
    perform public.descartar_importacao(v_importacao_a);
  exception
    when sqlstate 'FW404' then v_ok := true;
    when others then raise exception 'FALHA [ISO-5b]: esperado FW404, veio % (%)', sqlstate, sqlerrm;
  end;
  if not v_ok then
    raise exception 'FALHA [ISO-5b]: descartar_importacao aceitou a importacao de outro usuario';
  end if;

  -- [ISO-6] importacao_linhas: B não vê a linha de A e atualizar_linha_importacao => FW404.
  if (select count(*) from public.importacao_linhas where id = v_linha_a) <> 0 then
    raise exception 'FALHA [ISO-6a]: B enxerga a linha de importacao de A';
  end if;
  v_ok := false;
  begin
    perform public.atualizar_linha_importacao(v_linha_a, true);
  exception
    when sqlstate 'FW404' then v_ok := true;
    when others then raise exception 'FALHA [ISO-6b]: esperado FW404, veio % (%)', sqlstate, sqlerrm;
  end;
  if not v_ok then
    raise exception 'FALHA [ISO-6b]: atualizar_linha_importacao aceitou a linha de outro usuario';
  end if;

  -- [ISO-7] cofrinhos: B não vê o cofrinho de A e aportar_cofrinho => FW404.
  if (select count(*) from public.cofrinhos where id = v_cofrinho_a) <> 0 then
    raise exception 'FALHA [ISO-7a]: B enxerga o cofrinho de A';
  end if;
  v_ok := false;
  begin
    perform public.aportar_cofrinho(v_cofrinho_a, 1000);
  exception
    when sqlstate 'FW404' then v_ok := true;
    when others then raise exception 'FALHA [ISO-7b]: esperado FW404, veio % (%)', sqlstate, sqlerrm;
  end;
  if not v_ok then
    raise exception 'FALHA [ISO-7b]: aportar_cofrinho aceitou o cofrinho de outro usuario';
  end if;

  -- [ISO-8] movimentacoes_cofrinho: B não vê a movimentação de A. Não há RPC
  -- que opere por id de movimentação (só por cofrinho_id, já coberto acima
  -- em ISO-7) — aqui o assert é só de visibilidade sob RLS.
  if (select count(*) from public.movimentacoes_cofrinho where id = v_movimentacao_a) <> 0 then
    raise exception 'FALHA [ISO-8]: B enxerga a movimentacao de cofrinho de A';
  end if;

  -- [ISO-9] recorrencias: B não vê a recorrência de A e excluir_recorrencia => FW404.
  if (select count(*) from public.recorrencias where id = v_recorrencia_a) <> 0 then
    raise exception 'FALHA [ISO-9a]: B enxerga a recorrencia de A';
  end if;
  v_ok := false;
  begin
    perform public.excluir_recorrencia(v_recorrencia_a);
  exception
    when sqlstate 'FW404' then v_ok := true;
    when others then raise exception 'FALHA [ISO-9b]: esperado FW404, veio % (%)', sqlstate, sqlerrm;
  end;
  if not v_ok then
    raise exception 'FALHA [ISO-9b]: excluir_recorrencia aceitou a recorrencia de outro usuario';
  end if;

  raise notice 'OK: 18/18 asserts (isolamento cross-tenant: ISO-setup, ISO-1a/b/c, ISO-2, ISO-3a/b, ISO-4a/b, ISO-5a/b, ISO-6a/b, ISO-7a/b, ISO-8, ISO-9a/b — cartoes/faturas/transacoes/parcelas + as 7 tabelas de 0008-0015).';
end $$;

reset role;
rollback;
