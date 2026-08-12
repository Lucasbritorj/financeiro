-- =====================================================================
-- verificacao_importacao_dedup.sql
-- Casos de aceite da deduplicação de importação (migration 0020).
-- Termina em ROLLBACK: não persiste nada. Rode com o shim de auth
-- (tests/sql/00_shim_auth.sql) ou contra um usuário real de teste.
--
-- Executado de verdade em 10/08/2026 contra bqkichuwmugkjumpvrio:
--   C1[1a=3 novos | 2a=0 novos 3 dup | gravou 0] C2[noite=1 novo 2 dup,
--   gravou 1] C3[1 ambiguo, gravou 0] C4[2 gravados, reimport=0 novos]
--   C5[grafia diferente -> 1 dup] C6[unique id_externo barrou] razao 180->188
-- =====================================================================
begin;

do $teste$
declare
  -- Trocar pelo usuário de teste do ambiente. O shim de auth precisa fazer
  -- auth.uid() devolver este mesmo id.
  v_uid uuid := current_setting('app.test_user_id', true)::uuid;
  r jsonb; r2 jsonb; c jsonb;
  base_trx int; pos2 int;
  log text := ''; falhas text := '';
begin
  if v_uid is null then
    v_uid := (select id from auth.users order by created_at limit 1);
  end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_uid)::text, true);
  if auth.uid() is null then
    raise exception 'shim de auth não configurado: auth.uid() devolveu null';
  end if;

  select count(*) into base_trx
  from public.transacoes_origem where user_id = v_uid and deleted_at is null;

  -- ---------------------------------------------------------------
  -- C1 — mesmo arquivo OFX importado duas vezes: a 2ª tem 0 novos.
  --      Dedup por id_externo (FITID), o caminho autoritativo.
  -- ---------------------------------------------------------------
  r := public.criar_importacao('OFX', '[
    {"data":"2026-03-02","valor":-1550,"descricao":"PADARIA CENTRAL","id_externo":"FIT-A1"},
    {"data":"2026-03-02","valor":-8990,"descricao":"MERCADO SAO JOSE","id_externo":"FIT-A2"},
    {"data":"2026-03-03","valor":250000,"descricao":"SALARIO","id_externo":"FIT-A3"}]'::jsonb);
  if (r->>'novos')::int <> 3 then
    falhas := falhas || format('C1 1a: esperava 3 novos, veio %s. ', r->>'novos'); end if;
  c := public.confirmar_importacao((r->>'importacao_id')::uuid);
  if (c->>'transacoes_criadas')::int <> 3 then
    falhas := falhas || format('C1: esperava 3 criadas, veio %s. ', c->>'transacoes_criadas'); end if;

  r2 := public.criar_importacao('OFX', '[
    {"data":"2026-03-02","valor":-1550,"descricao":"PADARIA CENTRAL","id_externo":"FIT-A1"},
    {"data":"2026-03-02","valor":-8990,"descricao":"MERCADO SAO JOSE","id_externo":"FIT-A2"},
    {"data":"2026-03-03","valor":250000,"descricao":"SALARIO","id_externo":"FIT-A3"}]'::jsonb);
  if (r2->>'novos')::int <> 0 then
    falhas := falhas || format('C1 REIMPORT: esperava 0 novos, veio %s. ', r2->>'novos'); end if;
  c := public.confirmar_importacao((r2->>'importacao_id')::uuid);
  if (c->>'transacoes_criadas')::int <> 0 then
    falhas := falhas || format('C1 reimport gravou %s. ', c->>'transacoes_criadas'); end if;
  log := log || format('C1[1a=%s | 2a=%s novos %s dup] ', r->>'novos', r2->>'novos', r2->>'duplicadas');

  -- ---------------------------------------------------------------
  -- C2 — extrato sobreposto SEM id_externo (CSV): o arquivo da noite
  --      repete a manhã e traz uma nova. Só a nova é gravada.
  -- ---------------------------------------------------------------
  r := public.criar_importacao('CSV', '[
    {"data":"2026-04-10","valor":-3300,"descricao":"UBER TRIP"},
    {"data":"2026-04-10","valor":-1200,"descricao":"CAFE EXPRESSO"}]'::jsonb);
  if (r->>'novos')::int <> 2 then
    falhas := falhas || format('C2 manhã: esperava 2, veio %s. ', r->>'novos'); end if;
  perform public.confirmar_importacao((r->>'importacao_id')::uuid);

  r2 := public.criar_importacao('CSV', '[
    {"data":"2026-04-10","valor":-3300,"descricao":"UBER TRIP"},
    {"data":"2026-04-10","valor":-1200,"descricao":"CAFE EXPRESSO"},
    {"data":"2026-04-10","valor":-7500,"descricao":"FARMACIA POPULAR"}]'::jsonb);
  if (r2->>'novos')::int <> 1 then
    falhas := falhas || format('C2 noite: esperava 1 novo, veio %s. ', r2->>'novos'); end if;
  if (r2->>'duplicadas')::int <> 2 then
    falhas := falhas || format('C2 noite: esperava 2 dup, veio %s. ', r2->>'duplicadas'); end if;
  c := public.confirmar_importacao((r2->>'importacao_id')::uuid);
  if (c->>'transacoes_criadas')::int <> 1 then
    falhas := falhas || format('C2 noite gravou %s. ', c->>'transacoes_criadas'); end if;
  log := log || format('C2[noite=%s novo %s dup, gravou %s] ',
    r2->>'novos', r2->>'duplicadas', c->>'transacoes_criadas');

  -- ---------------------------------------------------------------
  -- C3 — linha AMBÍGUA: mesma data e valor de algo já gravado, com
  --      descrição diferente. Nasce ignorada; sem opt-in não grava.
  -- ---------------------------------------------------------------
  r := public.criar_importacao('CSV',
    '[{"data":"2026-04-10","valor":-7500,"descricao":"DROGARIA POPULAR SA"}]'::jsonb);
  if (r->>'ambiguos')::int <> 1 then
    falhas := falhas || format('C3: esperava 1 ambíguo, veio %s. ', r->>'ambiguos'); end if;
  if (r->>'novos')::int <> 0 then
    falhas := falhas || format('C3: ambíguo não pode contar como novo (veio %s). ', r->>'novos'); end if;
  c := public.confirmar_importacao((r->>'importacao_id')::uuid);
  if (c->>'transacoes_criadas')::int <> 0 then
    falhas := falhas || format('C3: ambíguo gravou %s sem opt-in. ', c->>'transacoes_criadas'); end if;
  log := log || format('C3[%s ambíguo, gravou %s] ', r->>'ambiguos', c->>'transacoes_criadas');

  -- ---------------------------------------------------------------
  -- C4 — repetição LEGÍTIMA: duas compras idênticas no mesmo dia.
  --      É o caso que o ordinal de ocorrência existe para proteger:
  --      as duas entram, e reimportar o arquivo continua dando 0 novos.
  -- ---------------------------------------------------------------
  r := public.criar_importacao('CSV', '[
    {"data":"2026-05-20","valor":-500,"descricao":"CAFETERIA DO LARGO"},
    {"data":"2026-05-20","valor":-500,"descricao":"CAFETERIA DO LARGO"}]'::jsonb);
  if (r->>'novos')::int <> 2 then
    falhas := falhas || format('C4: dois cafés legítimos, esperava 2 novos, veio %s. ', r->>'novos'); end if;
  c := public.confirmar_importacao((r->>'importacao_id')::uuid);
  if (c->>'transacoes_criadas')::int <> 2 then
    falhas := falhas || format('C4: esperava gravar 2, gravou %s. ', c->>'transacoes_criadas'); end if;
  r2 := public.criar_importacao('CSV', '[
    {"data":"2026-05-20","valor":-500,"descricao":"CAFETERIA DO LARGO"},
    {"data":"2026-05-20","valor":-500,"descricao":"CAFETERIA DO LARGO"}]'::jsonb);
  if (r2->>'novos')::int <> 0 then
    falhas := falhas || format('C4 reimport: esperava 0 novos, veio %s. ', r2->>'novos'); end if;
  log := log || format('C4[2 gravados, reimport=%s novos] ', r2->>'novos');

  -- ---------------------------------------------------------------
  -- C5 — normalização: espaço interno, caixa e pontuação diferentes
  --      apontam para a mesma transação. Era o furo do lower(trim()).
  -- ---------------------------------------------------------------
  r := public.criar_importacao('CSV',
    '[{"data":"2026-03-02","valor":-1550,"descricao":"  padaria   Central!!  "}]'::jsonb);
  if (r->>'duplicadas')::int <> 1 then
    falhas := falhas || format('C5: esperava 1 dup, veio %s dup / %s novos. ',
      r->>'duplicadas', r->>'novos'); end if;
  log := log || format('C5[grafia diferente -> %s dup] ', r->>'duplicadas');

  -- ---------------------------------------------------------------
  -- C6 — rede de segurança do Postgres: mesmo escrevendo direto na
  --      tabela, o unique index parcial barra o id_externo repetido.
  -- ---------------------------------------------------------------
  begin
    insert into public.transacoes_origem
      (user_id, descricao, valor_total, tipo, forma_pagamento, data_compra, num_parcelas, id_externo)
    values (v_uid, 'FORCADO', 1550, 'DESPESA', 'DEBITO', date '2026-03-02', 1, 'FIT-A1');
    falhas := falhas || 'C6: unique(id_externo) NÃO barrou inserção direta. ';
  exception when unique_violation then
    log := log || 'C6[unique id_externo barrou] ';
  end;

  select count(*) into pos2
  from public.transacoes_origem where user_id = v_uid and deleted_at is null;
  log := log || format('razão %s->%s', base_trx, pos2);

  if falhas <> '' then
    raise exception 'FALHOU >>> %', falhas;
  end if;
  raise notice 'OK: todos os asserts passaram >>> %', log;
end;
$teste$;

rollback;
