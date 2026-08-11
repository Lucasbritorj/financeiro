-- =====================================================================
-- verificacao_importacao_revisao_source.sql
-- Casos de aceite da migration 0021: dedup contra staging REVISAO (G1),
-- sha256 do arquivo (G2) e source na materialização (G3).
-- Complementa verificacao_importacao_dedup.sql (0020), que continua válido.
-- Termina em ROLLBACK: não persiste nada.
--
-- Executado de verdade em 10/08/2026 contra bqkichuwmugkjumpvrio:
--   R1[A=3 novos | B=0 novos 3 dup]  R2[A gravou 3, B gravou 0 sem erro]
--   R4[source=OFX]  R4b[180 linhas antigas com source NULL]
--   R3[2o envio ja_importado=true status_anterior=REVISAO novos=0]
--   R3b[apos descartar: ja_importado=false]
--   REG[2 cafes legitimos gravados, reimport=0 novos]  razao 180->185
-- =====================================================================
begin;

do $teste$
declare
  v_uid uuid := current_setting('app.test_user_id', true)::uuid;
  a jsonb; b jsonb; c jsonb; d jsonb;
  base int; depois int; v_src text; v_null_src int;
  log text := ''; falhas text := '';
  LINHAS constant jsonb := '[
    {"data":"2026-06-01","valor":-2500,"descricao":"MERCEARIA DO ZE","id_externo":"FX-1"},
    {"data":"2026-06-01","valor":-4100,"descricao":"POSTO IPIRANGA","id_externo":"FX-2"},
    {"data":"2026-06-02","valor":-1990,"descricao":"NETFLIX","id_externo":"FX-3"}]'::jsonb;
  SHA constant text := repeat('ab', 32);
begin
  if v_uid is null then
    v_uid := (select id from auth.users order by created_at limit 1);
  end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_uid)::text, true);
  if auth.uid() is null then
    raise exception 'shim de auth não configurado: auth.uid() devolveu null';
  end if;
  select count(*) into base from public.transacoes_origem where user_id=v_uid and deleted_at is null;

  -- ---------------------------------------------------------------
  -- R1 — GAP F1: importação A fica em REVISAO (não confirmada) e B traz
  --      as MESMAS linhas. Antes da 0021, B vinha toda NOVO porque nada
  --      olhava staging alheio. Agora B tem 0 novos.
  -- ---------------------------------------------------------------
  a := public.criar_importacao('OFX', LINHAS);
  if (a->>'novos')::int <> 3 then
    falhas := falhas || format('R1 A: esperava 3 novos, veio %s. ', a->>'novos'); end if;
  b := public.criar_importacao('OFX', LINHAS);
  if (b->>'novos')::int <> 0 then
    falhas := falhas || format('R1 B: esperava 0 NOVOS, veio %s. ', b->>'novos'); end if;
  if (b->>'duplicadas')::int <> 3 then
    falhas := falhas || format('R1 B: esperava 3 dup, veio %s. ', b->>'duplicadas'); end if;
  log := log || format('R1[A=%s novos | B=%s novos %s dup] ', a->>'novos', b->>'novos', b->>'duplicadas');

  -- ---------------------------------------------------------------
  -- R2 — confirmar A grava 3; confirmar B grava 0 SEM levantar FW409.
  --      Este é o ganho de UX: o erro deixa de acontecer porque a
  --      classificação ficou certa, não porque a rede de segurança pegou.
  -- ---------------------------------------------------------------
  c := public.confirmar_importacao((a->>'importacao_id')::uuid);
  if (c->>'transacoes_criadas')::int <> 3 then
    falhas := falhas || format('R2 A: esperava 3 criadas, veio %s. ', c->>'transacoes_criadas'); end if;
  begin
    d := public.confirmar_importacao((b->>'importacao_id')::uuid);
    if (d->>'transacoes_criadas')::int <> 0 then
      falhas := falhas || format('R2 B: esperava 0 criadas, veio %s. ', d->>'transacoes_criadas'); end if;
    log := log || format('R2[A gravou %s, B gravou %s sem erro] ',
      c->>'transacoes_criadas', d->>'transacoes_criadas');
  exception when others then
    falhas := falhas || format('R2 B: LEVANTOU %s (%s) — deveria gravar 0 sem erro. ', SQLSTATE, SQLERRM);
  end;

  -- ---------------------------------------------------------------
  -- R4 — source gravado com a origem da importação; histórico anterior
  --      à 0021 permanece NULL (não inventar proveniência).
  -- ---------------------------------------------------------------
  select source into v_src from public.transacoes_origem
   where user_id=v_uid and id_externo='FX-1' and deleted_at is null;
  if v_src is distinct from 'OFX' then
    falhas := falhas || format('R4: source esperava OFX, veio %L. ', v_src); end if;
  select count(*) into v_null_src from public.transacoes_origem
   where user_id=v_uid and deleted_at is null and source is null;
  log := log || format('R4[source=%s] R4b[%s antigas com NULL] ', v_src, v_null_src);

  -- ---------------------------------------------------------------
  -- R3 — sha256: reenvio byte-a-byte do mesmo arquivo volta cedo,
  --      apontando para a importação anterior, sem recriar staging.
  -- ---------------------------------------------------------------
  a := public.criar_importacao('CSV',
    '[{"data":"2026-07-01","valor":-999,"descricao":"ASSINATURA X"}]'::jsonb, SHA);
  if (a->>'arquivo_ja_importado')::boolean then
    falhas := falhas || 'R3: 1º envio não podia ser ja_importado. '; end if;
  b := public.criar_importacao('CSV',
    '[{"data":"2026-07-01","valor":-999,"descricao":"ASSINATURA X"}]'::jsonb, SHA);
  if not (b->>'arquivo_ja_importado')::boolean then
    falhas := falhas || 'R3 2º: esperava arquivo_ja_importado = true. '; end if;
  if (b->>'novos')::int <> 0 then
    falhas := falhas || format('R3 2º: esperava 0 novos, veio %s. ', b->>'novos'); end if;
  if (b->>'importacao_id') <> (a->>'importacao_id') then
    falhas := falhas || 'R3: deveria apontar para a importação anterior. '; end if;
  log := log || format('R3[ja_importado=%s status_anterior=%s] ',
    b->>'arquivo_ja_importado', b->>'status_anterior');

  -- R3b — DESCARTADA sai do índice: o usuário pode reenviar o mesmo
  --       arquivo (ex.: errou o preset de banco e quer refazer).
  perform public.descartar_importacao((a->>'importacao_id')::uuid);
  c := public.criar_importacao('CSV',
    '[{"data":"2026-07-01","valor":-999,"descricao":"ASSINATURA X"}]'::jsonb, SHA);
  if (c->>'arquivo_ja_importado')::boolean then
    falhas := falhas || 'R3b: após DESCARTADA deveria liberar reimport. '; end if;
  log := log || format('R3b[após descartar: ja_importado=%s] ', c->>'arquivo_ja_importado');

  -- ---------------------------------------------------------------
  -- REGRESSÃO 0020 — o ordinal de ocorrência continua protegendo a
  -- repetição legítima, e a reimportação pós-confirmação continua zerada.
  -- ---------------------------------------------------------------
  a := public.criar_importacao('CSV', '[
    {"data":"2026-08-01","valor":-700,"descricao":"CAFE DA ESQUINA"},
    {"data":"2026-08-01","valor":-700,"descricao":"CAFE DA ESQUINA"}]'::jsonb);
  if (a->>'novos')::int <> 2 then
    falhas := falhas || format('REG: dois cafés legítimos, esperava 2, veio %s. ', a->>'novos'); end if;
  perform public.confirmar_importacao((a->>'importacao_id')::uuid);
  b := public.criar_importacao('CSV', '[
    {"data":"2026-08-01","valor":-700,"descricao":"CAFE DA ESQUINA"},
    {"data":"2026-08-01","valor":-700,"descricao":"CAFE DA ESQUINA"}]'::jsonb);
  if (b->>'novos')::int <> 0 then
    falhas := falhas || format('REG reimport: esperava 0, veio %s. ', b->>'novos'); end if;
  log := log || format('REG[2 gravados, reimport=%s novos] ', b->>'novos');

  select count(*) into depois from public.transacoes_origem where user_id=v_uid and deleted_at is null;
  log := log || format('razão %s->%s', base, depois);

  if falhas <> '' then raise exception 'FALHOU >>> %', falhas; end if;
  raise notice 'PASSOU >>> %', log;
end;
$teste$;

rollback;
