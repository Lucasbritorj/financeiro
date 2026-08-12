-- =====================================================================
-- verificacao_excluir_cofrinho.sql
-- Casos de aceite da migration 0024. Termina em ROLLBACK.
--
-- Executado de verdade em 11/08/2026 contra bqkichuwmugkjumpvrio:
--   T1[criado, 2 aportes, saldo=50000]
--   T2[recusou FW409: Cofrinho "COFRE TESTE T1" ainda tem 50000]
--   T3[resgatou, excluiu, movs ocultadas=3]
--   T4[sob RLS: cofrinho=0 movs=0 visiveis]
--   T5[no banco: 1 cofrinho + 3 movs, todos com deleted_at]
--   T6[resgatou 77000 e excluiu numa operacao]
--   T7[reexclusao=FW404]  T8[arquivado excluido ok]
--
-- T4 é o teste que importa para o requisito "some da lista": troca o role
-- para `authenticated` e consulta de verdade sob RLS, em vez de simular o
-- predicado da policy.
-- T5 é o teste do requisito "não hard-delete": as linhas continuam lá.
-- =====================================================================
begin;

do $t$
declare
  v_uid uuid := current_setting('app.test_user_id', true)::uuid;
  v_c1 uuid; v_c2 uuid; v_c3 uuid; r jsonb;
  v_vis int; v_movs_vis int; v_saldo bigint; v_del timestamptz;
  v_erro text; v_sqlstate text;
  log text := ''; falhas text := '';
begin
  if v_uid is null then v_uid := (select id from auth.users order by created_at limit 1); end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_uid)::text, true);
  if auth.uid() is null then raise exception 'shim de auth não configurado'; end if;

  -- T1 — criar e aportar duas vezes.
  v_c1 := (public.criar_cofrinho('COFRE TESTE T1', 100000, 'CURTO', null, null, null)->>'cofrinho_id')::uuid;
  perform public.aportar_cofrinho(v_c1, 30000, current_date);
  perform public.aportar_cofrinho(v_c1, 20000, current_date);
  select saldo_atual into v_saldo from public.cofrinhos where id=v_c1;
  if v_saldo <> 50000 then falhas := falhas || format('T1: saldo=%s (esperava 50000). ', v_saldo); end if;
  log := log || format('T1[saldo=%s] ', v_saldo);

  -- T2 — excluir com saldo > 0 RECUSA, e não deixa efeito colateral.
  begin
    r := public.excluir_cofrinho(v_c1);
    falhas := falhas || 'T2: excluiu com saldo > 0 (deveria recusar). ';
  exception when others then
    get stacked diagnostics v_sqlstate = returned_sqlstate, v_erro = message_text;
    if v_sqlstate <> 'FW409' then
      falhas := falhas || format('T2: recusou com %s, esperava FW409. ', v_sqlstate); end if;
    log := log || format('T2[recusou %s] ', v_sqlstate);
  end;
  select saldo_atual, deleted_at into v_saldo, v_del from public.cofrinhos where id=v_c1;
  if v_del is not null or v_saldo <> 50000 then
    falhas := falhas || 'T2: a recusa não deixou o cofrinho intacto. '; end if;

  -- T3 — resgatar tudo pelo fluxo normal, depois excluir.
  perform public.resgatar_cofrinho(v_c1, 50000, current_date);
  r := public.excluir_cofrinho(v_c1);
  if (r->>'saldo_resgatado')::bigint <> 0 then
    falhas := falhas || format('T3: saldo_resgatado=%s (esperava 0). ', r->>'saldo_resgatado'); end if;
  log := log || format('T3[excluiu, movs ocultadas=%s] ', r->>'movimentacoes_ocultadas');

  -- T4 — sumiu da lista SOB RLS DE VERDADE (não é simulação do predicado).
  set local role authenticated;
  select count(*) into v_vis      from public.cofrinhos              where id = v_c1;
  select count(*) into v_movs_vis from public.movimentacoes_cofrinho where cofrinho_id = v_c1;
  reset role;
  if v_vis <> 0 then falhas := falhas || format('T4: cofrinho visível (%s). ', v_vis); end if;
  if v_movs_vis <> 0 then falhas := falhas || format('T4: %s movimentações visíveis. ', v_movs_vis); end if;
  log := log || format('T4[sob RLS: %s cofrinho, %s movs] ', v_vis, v_movs_vis);

  -- T5 — nada foi apagado fisicamente (requisito: não hard-delete).
  if (select count(*) from public.cofrinhos where id=v_c1) <> 1 then
    falhas := falhas || 'T5: linha do cofrinho sumiu do banco. '; end if;
  if (select count(*) from public.movimentacoes_cofrinho where cofrinho_id=v_c1) <> 3 then
    falhas := falhas || 'T5: movimentações sumiram do banco. '; end if;
  log := log || format('T5[no banco: 1 + %s movs] ',
    (select count(*) from public.movimentacoes_cofrinho where cofrinho_id=v_c1));

  -- T6 — "resgatar e excluir" numa operação, com o resgate registrado.
  v_c2 := (public.criar_cofrinho('COFRE TESTE T6', 100000, 'CURTO', null, null, null)->>'cofrinho_id')::uuid;
  perform public.aportar_cofrinho(v_c2, 77000, current_date);
  r := public.excluir_cofrinho(v_c2, true);
  if (r->>'saldo_resgatado')::bigint <> 77000 then
    falhas := falhas || format('T6: saldo_resgatado=%s. ', r->>'saldo_resgatado'); end if;
  if (select saldo_atual from public.cofrinhos where id=v_c2) <> 0 then
    falhas := falhas || 'T6: saldo não zerou. '; end if;
  if (select count(*) from public.movimentacoes_cofrinho
      where cofrinho_id=v_c2 and tipo='RESGATE' and valor=77000) <> 1 then
    falhas := falhas || 'T6: resgate total não foi registrado no histórico. '; end if;
  log := log || format('T6[resgatou %s] ', r->>'saldo_resgatado');

  -- T7 — excluir duas vezes devolve FW404, não duplica efeito.
  begin
    r := public.excluir_cofrinho(v_c2);
    falhas := falhas || 'T7: excluiu duas vezes. ';
  exception when others then
    get stacked diagnostics v_sqlstate = returned_sqlstate;
    if v_sqlstate <> 'FW404' then
      falhas := falhas || format('T7: veio %s, esperava FW404. ', v_sqlstate); end if;
    log := log || format('T7[%s] ', v_sqlstate);
  end;

  -- T8 — arquivado PODE ser excluído. resgatar_cofrinho recusa arquivado;
  -- excluir_cofrinho não pode herdar essa trava, porque cofrinho velho
  -- arquivado é justamente o caso mais comum de exclusão.
  begin
    v_c3 := (public.criar_cofrinho('COFRE TESTE T8', 50000, 'LONGO', null, null, null)->>'cofrinho_id')::uuid;
    perform public.arquivar_cofrinho(v_c3, true);
    r := public.excluir_cofrinho(v_c3);
    log := log || 'T8[arquivado excluído] ';
  exception when others then
    get stacked diagnostics v_sqlstate = returned_sqlstate, v_erro = message_text;
    falhas := falhas || format('T8: não excluiu arquivado (%s: %s). ', v_sqlstate, left(v_erro,40));
  end;

  if falhas <> '' then raise exception 'FALHOU >>> %  [log: %]', falhas, log; end if;
  raise notice 'OK: todos os asserts passaram >>> %', log;
end;
$t$;

rollback;
