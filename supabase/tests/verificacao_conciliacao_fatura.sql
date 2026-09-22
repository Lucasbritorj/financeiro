-- =====================================================================
-- verificacao_conciliacao_fatura.sql
-- Casos de aceite da migration 0023: conciliação fatura × extrato.
-- Termina em ROLLBACK: não persiste nada.
--
-- Executado de verdade em 11/08/2026 contra bqkichuwmugkjumpvrio:
--   massa[fatura venc=2026-04-10 valor=50000]
--   C1[liq=1 natureza=LIQUIDACAO_FATURA vinculo=ok]
--   C2[mar=50000 abr=0 soma=50000]        <- o critério: era 100000
--   C3[saidas_avista 71395 inalterado]
--   C4[parcial: natureza=CONSUMO sugerida=t auto=0]
--   C5[padaria: natureza=CONSUMO sugerida=f]
--   C6[fatura continua ABERTA]
-- =====================================================================
begin;

-- ---------------------------------------------------------------------
-- Gate 1 — heurística de texto isolada. Precisão importa mais que
-- cobertura: falso positivo aqui ESCONDE dinheiro do relatório, que é
-- falha silenciosa na direção errada.
--
-- Os 14 primeiros casos rodaram no Postgres em 11/08 (14/14).
-- Os 9 acrescentados pela 0025 (padrão Itaú + negativos novos) foram
-- validados por RÉPLICA da normalização + regex fora do banco — 23/23,
-- 0 regressão — mas AINDA NÃO rodaram no Postgres. Rode este arquivo
-- antes de considerar a 0025 verificada.
-- ---------------------------------------------------------------------
do $regex$
-- `i` precisa ser declarado: só o FOR sobre intervalo de inteiros declara a
-- variável sozinho; FOR sobre linhas exige record ou lista de escalares.
declare v_falhas text := ''; v_n int := 0; i record;
begin
  -- Sem parênteses em volta do SELECT: com eles o PL/pgSQL não compila
  -- ("loop variable of loop over rows must be a record variable").
  for i in
    select descricao, esperado from (values
      -- verbo antes do substantivo (0023)
      ('PAGAMENTO FATURA CARTAO', true), ('Pagamento de fatura', true),
      ('PGTO FATURA', true),             ('PAGTO  FATURA!!', true),
      ('PAG FATURA CARTAO NUBANK', true),('PAGAMENTO CARTAO DE CREDITO', true),
      ('Fatura do cartão', true),        ('PAGAMENTO CARTAO', true),
      -- 0025: substantivo + particípio, padrão Itaú visto em extrato real.
      -- Antes deste patch, 0 de 535 linhas OFX eram detectadas.
      ('FATURA PAGA Itau Uniclas', true),('FATURA PAGA ITAU UNICLAS', true),
      ('fatura paga', true),             ('FATURA QUITADA', true),
      ('Fatura Liquidada Bradesco', true),('FATURA  PAGA   ITAU', true),
      -- negativos
      ('PAGAMENTO PADARIA', false),      ('PAGAMENTO BOLETO ENERGIA', false),
      ('COMPRA CARTAO DEBITO', false),   ('FATURA CELULAR VIVO', false),
      ('TRANSFERENCIA PIX JOAO', false), ('PAGAMENTO SALARIO FUNCIONARIO', false),
      -- fatura de OUTRO serviço não pode virar liquidação de cartão
      ('FATURA ENERGIA CEMIG', false),
      -- "fatura" precisa ser palavra inteira: FATURAMENTO não conta
      ('FATURAMENTO PAGO CLIENTE', false),
      -- ordem invertida com verbo fica de fora de propósito (0025):
      -- não foi observada em extrato e afrouxaria sem evidência
      ('PAGA FATURA', false)
    ) as t(descricao, esperado)
  loop
    v_n := v_n + 1;
    if public.fn_parece_pagamento_fatura(i.descricao) <> i.esperado then
      v_falhas := v_falhas || format('%L esperava %s. ', i.descricao, i.esperado);
    end if;
  end loop;
  if v_falhas <> '' then raise exception 'REGEX FALHOU >>> %', v_falhas; end if;
  -- Contador dinâmico: a versão anterior tinha "14/14" fixo no texto e
  -- ficou mentindo assim que a 0025 acrescentou casos.
  raise notice 'regex %/% OK', v_n, v_n;
end;
$regex$;

-- ---------------------------------------------------------------------
-- Gate 2 — C1..C6 ponta a ponta.
-- ---------------------------------------------------------------------
do $t$
declare
  v_uid uuid := current_setting('app.test_user_id', true)::uuid;
  v_cartao uuid; v_trx uuid; v_fat uuid; v_venc date; v_valfat bigint;
  r jsonb; c jsonb;
  v_nat text; v_liq uuid; v_sug boolean;
  mar bigint; abr bigint;
  cart_antes bigint; cart_depois bigint;
  log text := ''; falhas text := '';
begin
  if v_uid is null then v_uid := (select id from auth.users order by created_at limit 1); end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_uid)::text, true);
  if auth.uid() is null then raise exception 'shim de auth não configurado'; end if;

  -- Massa: cartão fecha dia 20, vence dia 10. Compra em 05/03 entra na
  -- competência de março; como dia_vencimento <= dia_fechamento, o
  -- vencimento cai no mês seguinte (10/04). Conferido, não assumido.
  v_cartao := (public.criar_cartao('CARTAO C1', 500000, 20, 10)->>'cartao_id')::uuid;
  v_trx := (public.processar_transacao_completa(
              'COMPRA TESTE C1', 50000, 'DESPESA', 'CREDITO', v_cartao,
              date '2026-03-05', 1)->>'transacao_id')::uuid;
  select f.id, f.data_vencimento, v.valor_total_fatura into v_fat, v_venc, v_valfat
  from public.faturas f
  join public.vw_faturas_consolidadas v on v.id = f.id
  where f.cartao_id = v_cartao and f.deleted_at is null
  order by f.competencia limit 1;
  if v_valfat <> 50000 then
    falhas := falhas || format('massa: fatura deveria ser 50000, veio %s. ', v_valfat); end if;
  log := log || format('massa[venc=%s valor=%s] ', v_venc, v_valfat);

  select saidas_avista into cart_antes from public.vw_carteira;

  -- C1 — extrato traz o pagamento, valor exato, no dia do vencimento.
  r := public.criar_importacao('OFX', jsonb_build_array(jsonb_build_object(
         'data', v_venc::text, 'valor', -50000,
         'descricao', 'PAGAMENTO FATURA CARTAO', 'id_externo', 'LIQ-C1')));
  if (r->>'liquidacoes')::int <> 1 then
    falhas := falhas || format('C1: esperava 1 liquidação, veio %s. ', r->>'liquidacoes'); end if;
  select natureza_detectada, fatura_liquidada_id, liquidacao_sugerida
    into v_nat, v_liq, v_sug
  from public.importacao_linhas where importacao_id = (r->>'importacao_id')::uuid;
  if v_nat <> 'LIQUIDACAO_FATURA' then falhas := falhas || format('C1: natureza=%s. ', v_nat); end if;
  if v_liq is distinct from v_fat then falhas := falhas || 'C1: vinculou fatura errada. '; end if;
  if v_sug then falhas := falhas || 'C1: não devia ser apenas sugerida. '; end if;
  c := public.confirmar_importacao((r->>'importacao_id')::uuid);
  select natureza, fatura_liquidada_id into v_nat, v_liq
  from public.transacoes_origem where id_externo='LIQ-C1';
  if v_nat <> 'LIQUIDACAO_FATURA' or v_liq is distinct from v_fat then
    falhas := falhas || 'C1: materialização perdeu natureza/vínculo. '; end if;
  log := log || format('C1[liq=%s natureza=%s] ', r->>'liquidacoes', v_nat);

  -- C2 — o critério de aceite: competência não conta duas vezes.
  select coalesce(sum(valor_total),0) into mar from public.transacoes_origem
   where user_id=v_uid and deleted_at is null and tipo='DESPESA' and natureza='CONSUMO'
     and to_char(data_compra,'YYYY-MM')='2026-03'
     and (descricao like 'COMPRA TESTE%' or descricao like 'PAGAMENTO FATURA%');
  select coalesce(sum(valor_total),0) into abr from public.transacoes_origem
   where user_id=v_uid and deleted_at is null and tipo='DESPESA' and natureza='CONSUMO'
     and to_char(data_compra,'YYYY-MM')=to_char(v_venc,'YYYY-MM')
     and (descricao like 'COMPRA TESTE%' or descricao like 'PAGAMENTO FATURA%');
  if mar <> 50000 then falhas := falhas || format('C2: mês da compra=%s (esperava 50000). ', mar); end if;
  if abr <> 0     then falhas := falhas || format('C2: mês do pagamento=%s (esperava 0). ', abr); end if;
  log := log || format('C2[mar=%s abr=%s soma=%s] ', mar, abr, mar+abr);

  -- C3 — regime de caixa: saidas_avista ignora a liquidação. Quem subtrai
  -- a fatura continua sendo faturas_pagas, uma vez só.
  select saidas_avista into cart_depois from public.vw_carteira;
  if cart_depois <> cart_antes then
    falhas := falhas || format('C3: saidas_avista %s -> %s (liquidação vazou). ', cart_antes, cart_depois); end if;
  log := log || format('C3[saidas_avista %s inalterado] ', cart_antes);

  -- C4 — pagamento PARCIAL: valor não bate exato. Nasce CONSUMO (grava e
  -- conta, comportamento atual, sem regressão) + liquidacao_sugerida para
  -- a UI perguntar. Nunca vira liquidação automática.
  r := public.criar_importacao('OFX', jsonb_build_array(jsonb_build_object(
         'data', v_venc::text, 'valor', -48000,
         'descricao', 'PAGAMENTO FATURA CARTAO', 'id_externo', 'LIQ-C4')));
  select natureza_detectada, liquidacao_sugerida into v_nat, v_sug
  from public.importacao_linhas where importacao_id=(r->>'importacao_id')::uuid;
  if v_nat <> 'CONSUMO' then falhas := falhas || format('C4: parcial virou %s. ', v_nat); end if;
  if not v_sug then falhas := falhas || 'C4: parcial devia marcar liquidacao_sugerida. '; end if;
  if (r->>'liquidacoes')::int <> 0 then
    falhas := falhas || format('C4: %s liquidação automática indevida. ', r->>'liquidacoes'); end if;
  log := log || format('C4[parcial: %s sugerida=%s] ', v_nat, v_sug);

  -- C5 — regressão: descrição parecida que não é fatura.
  r := public.criar_importacao('OFX', jsonb_build_array(jsonb_build_object(
         'data', v_venc::text, 'valor', -50000,
         'descricao', 'PAGAMENTO PADARIA CENTRAL', 'id_externo', 'LIQ-C5')));
  select natureza_detectada, liquidacao_sugerida into v_nat, v_sug
  from public.importacao_linhas where importacao_id=(r->>'importacao_id')::uuid;
  if v_nat <> 'CONSUMO' or v_sug then
    falhas := falhas || format('C5: falso positivo (%s, sugerida=%s). ', v_nat, v_sug); end if;
  log := log || format('C5[padaria: %s] ', v_nat);

  -- C6 — confirmação da liquidação baixa a fatura; a view de caixa a conta uma vez.
  if (select status from public.faturas where id=v_fat) <> 'PAGA' then
    falhas := falhas || 'C6: fatura não virou PAGA na confirmação. '; end if;
  log := log || format('C6[fatura %s após confirmação] ', (select status from public.faturas where id=v_fat));

  if falhas <> '' then raise exception 'FALHOU >>> %  [log: %]', falhas, log; end if;
  raise notice 'OK: todos os asserts passaram >>> %', log;
end;
$t$;

rollback;
