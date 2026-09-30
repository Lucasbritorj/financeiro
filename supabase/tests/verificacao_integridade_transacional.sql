-- Regressões F01/F03/F04. O arquivo é autocontido e termina em rollback.
begin;

do $teste$
declare
  v_uid uuid := current_setting('app.test_user_id', true)::uuid;
  v_cartao uuid; v_compra uuid; v_fatura uuid; v_venc date;
  v_importacao jsonb; v_nova uuid; v_categoria uuid;
  v_antes bigint; v_depois bigint; v_ligadas int;
  v_source text; v_id_externo text; v_natureza text; v_link uuid;
  v_manual uuid; v_antiga jsonb; v_atual jsonb;
  v_bloqueou boolean := false; v_falhas text := '';
begin
  if v_uid is null then
    v_uid := (select id from auth.users order by created_at limit 1);
  end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role', 'authenticated')::text, true);
  if auth.uid() is null then raise exception 'shim de auth não configurado'; end if;

  -- F03: uma confirmação importa a liquidação, baixa a fatura e reduz o caixa uma vez.
  v_cartao := (public.criar_cartao('F03 CARTAO', 500000, 20, 10)->>'cartao_id')::uuid;
  v_compra := (public.processar_transacao_completa(
    'F03 COMPRA', 50000, 'DESPESA', 'CREDITO', v_cartao, date '2026-03-05', 1
  )->>'transacao_id')::uuid;
  select id, data_vencimento into v_fatura, v_venc
  from public.faturas where cartao_id=v_cartao and deleted_at is null order by competencia limit 1;
  select saldo_caixa into v_antes from public.vw_carteira;

  v_importacao := public.criar_importacao('OFX', jsonb_build_array(jsonb_build_object(
    'data', v_venc, 'valor', -50000, 'descricao', 'FATURA PAGA ITAU UNICLAS', 'id_externo', 'F03-FITID'
  )));
  perform public.confirmar_importacao((v_importacao->>'importacao_id')::uuid);
  select saldo_caixa into v_depois from public.vw_carteira;
  if (select status from public.faturas where id=v_fatura) <> 'PAGA' then
    v_falhas := v_falhas || 'F03: fatura não foi liquidada. ';
  end if;
  if v_depois <> v_antes - 50000 then
    v_falhas := v_falhas || format('F03: caixa %s -> %s, esperava %s. ', v_antes, v_depois, v_antes-50000);
  end if;
  select count(*) into v_ligadas from public.transacoes_origem
  where user_id=v_uid and fatura_liquidada_id=v_fatura and deleted_at is null;
  if v_ligadas <> 1 then v_falhas := v_falhas || format('F03: %s liquidações vivas. ', v_ligadas); end if;

  -- Repetir a mesma confirmação não cria segunda baixa nem segundo lançamento.
  begin
    perform public.confirmar_importacao((v_importacao->>'importacao_id')::uuid);
  exception when others then
    if sqlstate = 'FW409' then v_bloqueou := true; else raise; end if;
  end;
  if not v_bloqueou then v_falhas := v_falhas || 'F03: confirmar repetido não foi bloqueado. '; end if;
  select count(*) into v_ligadas from public.transacoes_origem
  where user_id=v_uid and fatura_liquidada_id=v_fatura and deleted_at is null;
  if v_ligadas <> 1 then v_falhas := v_falhas || 'F03: repetição criou segunda liquidação. '; end if;

  -- A constraint é a defesa de concorrência: uma segunda escrita no mesmo vínculo falha.
  begin
    insert into public.transacoes_origem
      (user_id,descricao,valor_total,tipo,forma_pagamento,data_compra,num_parcelas,natureza,fatura_liquidada_id)
    values (v_uid,'F03 CONCORRENTE',50000,'DESPESA','DEBITO',v_venc,1,'LIQUIDACAO_FATURA',v_fatura);
    v_falhas := v_falhas || 'F03: índice único não barrou segunda liquidação. ';
  exception when unique_violation then null;
  end;

  -- F01: trocar categoria preserva identidade do lançamento importado conciliado.
  v_categoria := (public.criar_categoria('F01 CATEGORIA')->>'categoria_id')::uuid;
  select id into v_nova from public.transacoes_origem
  where user_id=v_uid and id_externo='F03-FITID' and deleted_at is null;
  v_nova := (public.substituir_transacao(v_nova, 'FATURA PAGA ITAU UNICLAS', 50000,
    'DESPESA', 'DEBITO', null, v_venc, 1, v_categoria)->>'transacao_id')::uuid;
  select source,id_externo,natureza,fatura_liquidada_id into v_source,v_id_externo,v_natureza,v_link
  from public.transacoes_origem where id=v_nova;
  if v_source <> 'OFX' or v_id_externo <> 'F03-FITID' or v_natureza <> 'LIQUIDACAO_FATURA'
     or v_link is distinct from v_fatura then
    v_falhas := v_falhas || 'F01: substituição perdeu metadados de origem/liquidação. ';
  end if;

  -- F01: alteração estrutural de liquidação é recusada; descrição/categoria seguem permitidas.
  v_bloqueou := false;
  begin
    perform public.substituir_transacao(v_nova, 'FATURA PAGA ITAU UNICLAS', 49999,
      'DESPESA', 'DEBITO', null, v_venc, 1, v_categoria);
  exception when others then
    if sqlstate = 'FW409' then v_bloqueou := true; else raise; end if;
  end;
  if not v_bloqueou then v_falhas := v_falhas || 'F01: alteração estrutural de liquidação não foi recusada. '; end if;

  -- F04: editar atualiza o fingerprint; extrato anterior não é duplicado e o atual é.
  v_manual := (public.processar_transacao_completa(
    'F04 CAFE', 1000, 'DESPESA', 'DEBITO', null, date '2026-05-06', 1
  )->>'transacao_id')::uuid;
  perform public.editar_transacao(v_manual, null, 2000, null);
  v_antiga := public.criar_importacao('CSV', jsonb_build_array(jsonb_build_object(
    'data', '2026-05-06', 'valor', -1000, 'descricao', 'F04 CAFE', 'id_externo', 'F04-ANTIGA'
  )));
  if (v_antiga->>'duplicadas')::int <> 0 then
    v_falhas := v_falhas || 'F04: extrato anterior continuou DUPLICADO. ';
  end if;
  v_atual := public.criar_importacao('CSV', jsonb_build_array(jsonb_build_object(
    'data', '2026-05-06', 'valor', -2000, 'descricao', 'F04 CAFE', 'id_externo', 'F04-ATUAL'
  )));
  if (v_atual->>'duplicadas')::int <> 1 then
    v_falhas := v_falhas || 'F04: extrato atualizado não foi DUPLICADO. ';
  end if;

  -- F05: fatura já baixada à mão não aborta a importação do extrato que a paga.
  v_cartao := (public.criar_cartao('F05 CARTAO', 500000, 20, 10)->>'cartao_id')::uuid;
  perform public.processar_transacao_completa(
    'F05 COMPRA', 30000, 'DESPESA', 'CREDITO', v_cartao, date '2026-03-05', 1);
  select id, data_vencimento into v_fatura, v_venc
  from public.faturas where cartao_id=v_cartao and deleted_at is null order by competencia limit 1;
  perform public.processar_pagamento_fatura(v_fatura, v_venc::timestamptz);
  v_importacao := public.criar_importacao('OFX', jsonb_build_array(
    jsonb_build_object('data', v_venc, 'valor', -30000,
      'descricao', 'FATURA PAGA ITAU UNICLAS', 'id_externo', 'F05-FITID'),
    jsonb_build_object('data', v_venc, 'valor', -1234,
      'descricao', 'F05 PADARIA', 'id_externo', 'F05-OUTRA')));
  begin
    perform public.confirmar_importacao((v_importacao->>'importacao_id')::uuid);
  exception when others then
    v_falhas := v_falhas || format('F05: fatura já PAGA abortou a importação (%s). ', sqlstate);
  end;
  if not exists (select 1 from public.transacoes_origem
                 where user_id=v_uid and id_externo='F05-OUTRA' and deleted_at is null) then
    v_falhas := v_falhas || 'F05: linha sem relação com a fatura não foi gravada. ';
  end if;

  -- RLS/menor privilégio: as RPCs ficam para authenticated, não para anon,
  -- e a tabela continua com RLS habilitada.
  if has_function_privilege('anon', 'public.confirmar_importacao(uuid)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.confirmar_importacao(uuid)', 'EXECUTE')
     or not (select relrowsecurity from pg_class where oid='public.transacoes_origem'::regclass) then
    v_falhas := v_falhas || 'Segurança: privilégios/RLS de confirmar_importacao incorretos. ';
  end if;

  if v_falhas <> '' then raise exception 'FALHOU >>> %', v_falhas; end if;
  raise notice 'OK: 11 asserts F01/F03/F04/F05 (fatura já paga, metadados, caixa, idempotência, concorrência, fingerprint, RLS/privilégios)';
end;
$teste$;

rollback;