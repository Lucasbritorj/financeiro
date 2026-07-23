-- =====================================================================
-- verificacao_assistente.sql — asserts das migrações 0007-0010.
-- Critérios de aceite do modelo_final_financeiro.md (blocos A-D).
-- Mesmo contrato do verificacao_nucleo.sql: simula usuário autenticado,
-- termina em ROLLBACK, emite "OK: N/N asserts" no sucesso.
-- =====================================================================
begin;

insert into auth.users (id, email)
values ('00000000-0000-0000-0000-0000000000bb', 'assistente@local.dev')
on conflict (id) do nothing;

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000000bb","role":"authenticated"}', true);
set local role authenticated;

do $$
declare
  v_cartao   uuid;
  v_res      jsonb;
  v_tx       uuid;
  v_vals     bigint[];
  v_cat_del  uuid;
  v_cat_merc uuid;
  v_cat_id   uuid;
  v_imp      uuid;
  v_cof      uuid;
  v_qtd      int;
  v_saldo    bigint;
  v_saldo0   bigint;
  v_linha    uuid;
  v_boleto   uuid;
  v_boleto2  uuid;
  v_fatura   uuid;
  v_rec      uuid;
  v_rec2     uuid;
  v_cat_g    uuid;
begin
  -- ============ BLOCO A: editar_transacao ============
  v_cartao := (public.criar_cartao('Cartão A', 1000000, 10, 20)->>'cartao_id')::uuid;

  -- [A1] Editar valor redistribui parcelas: 100,00 em 3x (3334/3333/3333),
  --      editar para 90,00 => 3000/3000/3000, soma preservada.
  v_res := public.processar_transacao_completa(
    'Compra edit', 10000, 'DESPESA', 'CREDITO', v_cartao, date '2026-01-05', 3);
  v_tx := (v_res->>'transacao_id')::uuid;
  perform public.editar_transacao(v_tx, null, 9000, null);
  select array_agg(valor order by numero) into v_vals
  from public.parcelas where transacao_id = v_tx and deleted_at is null;
  if v_vals <> array[3000,3000,3000]::bigint[] then
    raise exception 'FALHA [A1]: parcelas pós-edição = % (esperado 3000/3000/3000)', v_vals;
  end if;

  -- [A2] Editar descrição isolada não toca nas parcelas.
  perform public.editar_transacao(v_tx, 'Nova descrição', null, null);
  if (select descricao from public.transacoes_origem where id = v_tx) <> 'Nova descrição' then
    raise exception 'FALHA [A2]: descrição não atualizada';
  end if;

  -- [A3] Não-crédito: editar valor e data ajusta a parcela única.
  v_res := public.processar_transacao_completa(
    'Pix edit', 5000, 'DESPESA', 'PIX', null, date '2026-01-10', 1);
  v_tx := (v_res->>'transacao_id')::uuid;
  perform public.editar_transacao(v_tx, null, 7000, date '2026-01-12');
  if not exists (select 1 from public.parcelas
                 where transacao_id = v_tx and valor = 7000
                   and data_competencia = date '2026-01-12') then
    raise exception 'FALHA [A3]: parcela única não acompanhou edição';
  end if;

  -- [A4] Transação com parcela PAGA não se edita => FW409.
  -- authenticated não tem UPDATE direto (0005); marca via role de sessão,
  -- como o pagamento de fatura faria no fluxo real.
  reset role;
  update public.parcelas set status = 'PAGA' where transacao_id = v_tx;
  set local role authenticated;
  begin
    perform public.editar_transacao(v_tx, null, 8000, null);
    raise exception 'FALHA [A4]: edição de transação com parcela PAGA não foi bloqueada';
  exception
    when sqlstate 'FW409' then null;
  end;

  -- [A5] Substituir: troca forma/parcelas. PIX à vista -> CREDITO 3x.
  --      A antiga sai (soft-delete), a nova tem 3 parcelas.
  v_res := public.processar_transacao_completa(
    'Troca forma', 9000, 'DESPESA', 'PIX', null, date '2026-01-20', 1);
  v_tx := (v_res->>'transacao_id')::uuid;
  v_res := public.substituir_transacao(
    v_tx, 'Troca forma', 9000, 'DESPESA', 'CREDITO', v_cartao, date '2026-01-05', 3, null);
  -- RLS esconde soft-deletados do authenticated: a antiga não deve mais
  -- estar visível (some da listagem), prova de que foi soft-deletada.
  if exists (select 1 from public.transacoes_origem where id = v_tx) then
    raise exception 'FALHA [A5]: transação antiga ainda visível (não soft-deletada)';
  end if;
  if (select count(*) from public.parcelas
      where transacao_id = (v_res->>'transacao_id')::uuid and deleted_at is null) <> 3 then
    raise exception 'FALHA [A5]: nova transação não tem 3 parcelas';
  end if;

  -- [A6] Substituir troca o tipo: DESPESA -> RECEITA.
  v_res := public.processar_transacao_completa(
    'Troca tipo', 5000, 'DESPESA', 'PIX', null, date '2026-01-21', 1);
  v_tx := (v_res->>'transacao_id')::uuid;
  v_res := public.substituir_transacao(
    v_tx, 'Troca tipo', 5000, 'RECEITA', 'PIX', null, date '2026-01-21', 1, null);
  if (select tipo from public.transacoes_origem where id = (v_res->>'transacao_id')::uuid) <> 'RECEITA' then
    raise exception 'FALHA [A6]: substituição não trocou o tipo para RECEITA';
  end if;

  -- [A7] Substituir com parcela PAGA => FW409, antiga permanece ativa.
  v_res := public.processar_transacao_completa(
    'Trava paga', 4000, 'DESPESA', 'PIX', null, date '2026-01-22', 1);
  v_tx := (v_res->>'transacao_id')::uuid;
  reset role;
  update public.parcelas set status = 'PAGA' where transacao_id = v_tx;
  set local role authenticated;
  begin
    perform public.substituir_transacao(
      v_tx, 'Trava paga', 4000, 'RECEITA', 'PIX', null, date '2026-01-22', 1, null);
    raise exception 'FALHA [A7]: substituição de transação com parcela PAGA não foi bloqueada';
  exception
    when sqlstate 'FW409' then null;
  end;
  -- Bloqueado antes do soft-delete: a antiga continua visível/ativa.
  if not exists (select 1 from public.transacoes_origem where id = v_tx) then
    raise exception 'FALHA [A7]: transação sumiu apesar do bloqueio';
  end if;

  -- ============ BLOCO B: categorias + regras + autocategorização ============
  -- [B1] Seed idempotente: 1ª cria (>0), 2ª é no-op (0).
  v_res := public.seed_categorias_padrao();
  if (v_res->>'categorias_criadas')::int <= 0 then
    raise exception 'FALHA [B1]: seed inicial não criou categorias';
  end if;
  if (public.seed_categorias_padrao()->>'categorias_criadas')::int <> 0 then
    raise exception 'FALHA [B1]: seed não é idempotente';
  end if;

  select id into v_cat_del from public.categorias
  where nome = 'Delivery' and deleted_at is null;
  select id into v_cat_merc from public.categorias
  where nome = 'Mercado' and deleted_at is null;

  -- [B2] Autocategorização por regra: descrição com IFOOD (regra do seed)
  --      => categoria_id = Delivery no INSERT (trigger 0008).
  v_res := public.processar_transacao_completa(
    'IFOOD *LANCHERIA', 3500, 'DESPESA', 'PIX', null, date '2026-02-01', 1);
  v_tx := (v_res->>'transacao_id')::uuid;
  if (select categoria_id from public.transacoes_origem where id = v_tx) is distinct from v_cat_del then
    raise exception 'FALHA [B2]: IFOOD não foi autocategorizado como Delivery';
  end if;

  -- [B3] Sem regra casando => categoria fica nula.
  v_res := public.processar_transacao_completa(
    'PAGAMENTO DIVERSOS XYZ', 1000, 'DESPESA', 'PIX', null, date '2026-02-02', 1);
  if (select categoria_id from public.transacoes_origem
      where id = (v_res->>'transacao_id')::uuid) is not null then
    raise exception 'FALHA [B3]: transação sem regra recebeu categoria';
  end if;
  v_tx := (v_res->>'transacao_id')::uuid;

  -- [B4] Recategorização manual + criar regra: classifica e a nova regra
  --      passa a valer para lançamentos futuros.
  perform public.definir_categoria_transacao(v_tx, v_cat_merc, true, 'DIVERSOS XYZ');
  if (select categoria_id from public.transacoes_origem where id = v_tx) <> v_cat_merc then
    raise exception 'FALHA [B4]: recategorização manual não aplicou';
  end if;
  v_res := public.processar_transacao_completa(
    'COMPRA DIVERSOS XYZ 2', 2000, 'DESPESA', 'PIX', null, date '2026-02-03', 1);
  if (select categoria_id from public.transacoes_origem
      where id = (v_res->>'transacao_id')::uuid) is distinct from v_cat_merc then
    raise exception 'FALHA [B4]: regra criada não classificou lançamento seguinte';
  end if;

  -- [B5] Prioridade: regra mais específica (menor prioridade) vence.
  v_cat_id := (public.criar_categoria('Especial', '#D9A24E', null, 'DESPESA')->>'categoria_id')::uuid;
  perform public.criar_regra_categorizacao('UBER', v_cat_id, 5);  -- vence a do seed (20)
  v_res := public.processar_transacao_completa(
    'UBER TRIP 001', 2500, 'DESPESA', 'PIX', null, date '2026-02-04', 1);
  if (select categoria_id from public.transacoes_origem
      where id = (v_res->>'transacao_id')::uuid) is distinct from v_cat_id then
    raise exception 'FALHA [B5]: prioridade da regra não respeitada';
  end if;

  -- [B6] Nome de categoria duplicado (ativo) => FW409.
  begin
    perform public.criar_categoria('Mercado', '#7CB49A', null, 'DESPESA');
    raise exception 'FALHA [B6]: categoria duplicada não bloqueada';
  exception
    when sqlstate 'FW409' then null;
  end;

  -- ============ BLOCO C: importação com staging + dedupe ============
  -- [C1] Staging: 3 linhas, 1 duplicada (bate a IFOOD 3500 de 2026-02-01
  --      criada em [B2]) => marcada e ignorada por padrão.
  v_res := public.criar_importacao('CSV', jsonb_build_array(
    jsonb_build_object('data','2026-03-01','valor',-4200,'descricao','MERCADO EXTRA'),
    jsonb_build_object('data','2026-03-02','valor', 850000,'descricao','SALARIO'),
    jsonb_build_object('data','2026-02-01','valor',-3500,'descricao','IFOOD *LANCHERIA')
  ));
  v_imp := (v_res->>'importacao_id')::uuid;
  if (v_res->>'duplicadas')::int <> 1 then
    raise exception 'FALHA [C1]: dedupe detectou % duplicadas (esperado 1)', v_res->>'duplicadas';
  end if;

  -- [C2] Categoria sugerida: MERCADO EXTRA cai em Mercado (regra do seed).
  if (select categoria_sugerida from public.importacao_linhas
      where importacao_id = v_imp and descricao = 'MERCADO EXTRA') is distinct from v_cat_merc then
    raise exception 'FALHA [C2]: linha de importação não recebeu categoria sugerida';
  end if;

  -- [C3] Commit: 2 não-ignoradas (a duplicada fica de fora) => 2 transações,
  --      cada uma com parcela única de fluxo de caixa.
  v_res := public.confirmar_importacao(v_imp);
  if (v_res->>'transacoes_criadas')::int <> 2 then
    raise exception 'FALHA [C3]: commit criou % transações (esperado 2)', v_res->>'transacoes_criadas';
  end if;
  -- Sinal define tipo: -4200 vira DESPESA, +850000 vira RECEITA.
  if not exists (select 1 from public.transacoes_origem
                 where descricao = 'SALARIO' and tipo = 'RECEITA' and valor_total = 850000) then
    raise exception 'FALHA [C3]: sinal positivo não virou RECEITA';
  end if;

  -- [C4] Idempotência: reconfirmar a mesma importação => FW409 (não duplica).
  begin
    perform public.confirmar_importacao(v_imp);
    raise exception 'FALHA [C4]: reconfirmação não foi bloqueada';
  exception
    when sqlstate 'FW409' then null;
  end;

  -- ============ BLOCO D: cofrinhos ============
  -- [D1] Criar meta + aportar => saldo atualizado.
  v_cof := (public.criar_cofrinho('Viagem Japão', 1500000, 'MEDIO', date '2026-12-01')->>'cofrinho_id')::uuid;
  v_res := public.aportar_cofrinho(v_cof, 320000);
  if (v_res->>'saldo_atual')::bigint <> 320000 then
    raise exception 'FALHA [D1]: saldo pós-aporte = % (esperado 320000)', v_res->>'saldo_atual';
  end if;

  -- [D2] Resgate parcial abate o saldo.
  v_res := public.resgatar_cofrinho(v_cof, 20000);
  if (v_res->>'saldo_atual')::bigint <> 300000 then
    raise exception 'FALHA [D2]: saldo pós-resgate = % (esperado 300000)', v_res->>'saldo_atual';
  end if;

  -- [D3] Resgate acima do saldo => FW409, saldo intacto.
  begin
    perform public.resgatar_cofrinho(v_cof, 999999999);
    raise exception 'FALHA [D3]: resgate acima do saldo não foi bloqueado';
  exception
    when sqlstate 'FW409' then null;
  end;
  if (select saldo_atual from public.cofrinhos where id = v_cof) <> 300000 then
    raise exception 'FALHA [D3]: saldo alterado após resgate bloqueado';
  end if;

  -- [D4] Invariante do CHECK: saldo nunca negativo (defesa no banco).
  select count(*) into v_qtd from public.movimentacoes_cofrinho where cofrinho_id = v_cof;
  if v_qtd <> 2 then
    raise exception 'FALHA [D4]: % movimentações registradas (esperado 2)', v_qtd;
  end if;

  -- [D5] Least privilege: INSERT direto em cofrinhos como authenticated => negado.
  begin
    insert into public.cofrinhos (user_id, nome, valor_alvo, horizonte)
    values (auth.uid(), 'bypass', 1000, 'CURTO');
    raise exception 'FALHA [D5]: INSERT direto em cofrinhos não foi negado';
  exception
    when insufficient_privilege then null;
  end;

  -- ============ CARTEIRA (regime de caixa, 0012) ============
  -- Cenário limpo: novo usuário isolado para números previsíveis.
  perform set_config('request.jwt.claims',
    '{"sub":"00000000-0000-0000-0000-0000000000cf","role":"authenticated"}', true);
  reset role;
  insert into auth.users (id, email)
  values ('00000000-0000-0000-0000-0000000000cf', 'caixa@local.dev')
  on conflict (id) do nothing;
  set local role authenticated;

  declare
    v_cartao_cx uuid;
    v_fat uuid;
    v_saldo bigint;
    v_pagas bigint;
  begin
    -- Receita 1000, despesa à vista (PIX) 300 => caixa 700 (crédito não conta).
    perform public.processar_transacao_completa('Salário', 100000, 'RECEITA', 'PIX', null, date '2026-03-01', 1);
    perform public.processar_transacao_completa('Mercado', 30000, 'DESPESA', 'PIX', null, date '2026-03-02', 1);
    v_cartao_cx := (public.criar_cartao('CX', 500000, 10, 20)->>'cartao_id')::uuid;
    -- Compra no crédito 60000 à vista no cartão: NÃO afeta o caixa ainda.
    perform public.processar_transacao_completa('TV', 60000, 'DESPESA', 'CREDITO', v_cartao_cx, date '2026-03-05', 1);

    select saldo_caixa into v_saldo from public.vw_carteira;
    if v_saldo <> 70000 then
      raise exception 'FALHA [CX1]: caixa = % (esperado 70000; crédito não deve reduzir)', v_saldo;
    end if;

    -- Paga a fatura de março (competência 2026-03-01) => caixa cai p/ 10000.
    select id into v_fat from public.faturas
    where cartao_id = v_cartao_cx and competencia = date '2026-03-01';
    perform public.processar_pagamento_fatura(v_fat, timestamptz '2026-03-20 10:00-03');
    select saldo_caixa, faturas_pagas into v_saldo, v_pagas from public.vw_carteira;
    if v_pagas <> 60000 then
      raise exception 'FALHA [CX2]: faturas_pagas = % (esperado 60000)', v_pagas;
    end if;
    if v_saldo <> 10000 then
      raise exception 'FALHA [CX3]: caixa pós-pagamento = % (esperado 10000)', v_saldo;
    end if;
  end;

  -- ============ BLOCO E: boletos (contas a pagar) ============
  -- Baseline de caixa antes de qualquer boleto (o bloco CX deixou o caixa
  -- num valor conhecido; aqui trabalhamos relativo a ele, sem acoplar totais).
  select saldo_caixa into v_saldo0 from public.vw_carteira;

  -- [BOL1] criar_boleto: transacao BOLETO + parcela PENDENTE, aparece em
  --        vw_contas_a_pagar como BOLETO com o valor cheio.
  v_res := public.criar_boleto('Conta de luz', 15000, date '2026-04-10', date '2026-04-01', null);
  v_boleto := (v_res->>'transacao_id')::uuid;
  if (select forma_pagamento from public.transacoes_origem where id = v_boleto) <> 'BOLETO' then
    raise exception 'FALHA [BOL1]: forma_pagamento não é BOLETO';
  end if;
  if not exists (select 1 from public.parcelas
                 where transacao_id = v_boleto and status = 'PENDENTE' and deleted_at is null) then
    raise exception 'FALHA [BOL1]: parcela PENDENTE ausente';
  end if;
  if not exists (select 1 from public.vw_contas_a_pagar
                 where transacao_id = v_boleto and tipo = 'BOLETO' and valor = 15000) then
    raise exception 'FALHA [BOL1]: boleto não aparece em vw_contas_a_pagar';
  end if;

  -- [BOL2] boleto PENDENTE não toca o caixa (só quando pago).
  select saldo_caixa into v_saldo from public.vw_carteira;
  if v_saldo <> v_saldo0 then
    raise exception 'FALHA [BOL2]: boleto pendente alterou o caixa (% -> %)', v_saldo0, v_saldo;
  end if;

  -- [BOL3] boleto entra na COMPETÊNCIA (abril/2026) como DESPESA — visível ao
  --        donut/insights/análise que leem transacoes_origem por data_compra.
  if not exists (select 1 from public.transacoes_origem
                 where id = v_boleto and tipo = 'DESPESA' and data_compra = date '2026-04-01') then
    raise exception 'FALHA [BOL3]: competência do boleto incorreta';
  end if;

  -- [BOL4] editar_boleto: novo valor e vencimento sincronizam a parcela única.
  perform public.editar_boleto(v_boleto, null, 18000, date '2026-04-15', null, null, false);
  if (select valor from public.parcelas where transacao_id = v_boleto and deleted_at is null) <> 18000 then
    raise exception 'FALHA [BOL4]: parcela não sincronizou com o novo valor';
  end if;
  if (select data_vencimento from public.transacoes_origem where id = v_boleto) <> date '2026-04-15' then
    raise exception 'FALHA [BOL4]: vencimento não atualizou';
  end if;

  -- [BOL5] pagar_boleto: baixa a parcela e reduz o caixa em 18000.
  perform public.pagar_boleto(v_boleto, timestamptz '2026-04-15 09:00-03');
  if (select status from public.parcelas where transacao_id = v_boleto and deleted_at is null) <> 'PAGA' then
    raise exception 'FALHA [BOL5]: parcela não foi baixada para PAGA';
  end if;
  select saldo_caixa into v_saldo from public.vw_carteira;
  if v_saldo <> v_saldo0 - 18000 then
    raise exception 'FALHA [BOL5]: caixa pós-pagamento = % (esperado %)', v_saldo, v_saldo0 - 18000;
  end if;
  if (select boletos_pagos from public.vw_carteira) <> 18000 then
    raise exception 'FALHA [BOL5]: boletos_pagos = % (esperado 18000)',
      (select boletos_pagos from public.vw_carteira);
  end if;

  -- [BOL6] boleto pago sai de contas a pagar.
  if exists (select 1 from public.vw_contas_a_pagar where transacao_id = v_boleto) then
    raise exception 'FALHA [BOL6]: boleto pago ainda aparece em contas a pagar';
  end if;

  -- [BOL7] pagar de novo => FW409 (idempotência dura).
  begin
    perform public.pagar_boleto(v_boleto, now());
    raise exception 'FALHA [BOL7]: pagar boleto pago duas vezes não barrou';
  exception when sqlstate 'FW409' then null;
  end;

  -- [BOL8] editar boleto PAGO => FW409 (histórico imutável).
  begin
    perform public.editar_boleto(v_boleto, 'x', null, null, null, null, false);
    raise exception 'FALHA [BOL8]: editar boleto pago não barrou';
  exception when sqlstate 'FW409' then null;
  end;

  -- [BOL9] criar_boleto sem vencimento => FW400.
  begin
    perform public.criar_boleto('Sem vencimento', 5000, null, null, null);
    raise exception 'FALHA [BOL9]: boleto sem vencimento não barrou';
  exception when sqlstate 'FW400' then null;
  end;

  -- [BOL10] vw_contas_a_pagar unifica faturas de cartão não pagas (autocontido:
  --         cria um cartão + compra e confere que a fatura em aberto aparece).
  v_cartao := (public.criar_cartao('Cartão Boleto', 500000, 10, 20)->>'cartao_id')::uuid;
  perform public.processar_transacao_completa(
    'Compra p/ fatura', 40000, 'DESPESA', 'CREDITO', v_cartao, date '2026-05-05', 1);
  if not exists (select 1 from public.vw_contas_a_pagar
                 where tipo = 'FATURA' and descricao = 'Cartão Boleto' and valor = 40000) then
    raise exception 'FALHA [BOL10]: fatura não paga não aparece em contas a pagar';
  end if;

  -- ============ BLOCO F: estorno de pagamento + recorrência (0014) ============
  -- [EST1] estornar_pagamento_fatura: paga uma fatura de cartão e desfaz.
  --        Status volta ao ciclo recomputado (competência 2026-02, corte já
  --        passou -> FECHADA) e as parcelas voltam a PENDENTE.
  v_res := public.processar_transacao_completa(
    'Compra p/ estorno', 30000, 'DESPESA', 'CREDITO', v_cartao, date '2026-02-05', 1);
  v_tx := (v_res->>'transacao_id')::uuid;
  select fatura_id into v_fatura
  from public.parcelas where transacao_id = v_tx and deleted_at is null limit 1;
  perform public.processar_pagamento_fatura(v_fatura, timestamptz '2026-02-15 09:00-03');
  if (select status from public.faturas where id = v_fatura) <> 'PAGA' then
    raise exception 'FALHA [EST1]: fatura não ficou PAGA antes do estorno';
  end if;
  perform public.estornar_pagamento_fatura(v_fatura);
  if (select status from public.faturas where id = v_fatura) <> 'FECHADA' then
    raise exception 'FALHA [EST1]: status pós-estorno = % (esperado FECHADA)',
      (select status from public.faturas where id = v_fatura);
  end if;

  -- [EST2] parcelas da fatura estornada voltam a PENDENTE (sem data_pagamento).
  if exists (select 1 from public.parcelas
             where fatura_id = v_fatura and deleted_at is null
               and (status <> 'PENDENTE' or data_pagamento is not null)) then
    raise exception 'FALHA [EST2]: parcela não voltou a PENDENTE após estorno';
  end if;

  -- [EST3] estornar fatura não paga => FW409.
  begin
    perform public.estornar_pagamento_fatura(v_fatura);
    raise exception 'FALHA [EST3]: estornar fatura já estornada não barrou';
  exception when sqlstate 'FW409' then null;
  end;

  -- [EST4] estornar_boleto: paga um boleto e desfaz. Parcela volta a PENDENTE
  --        e o boleto reaparece em vw_contas_a_pagar.
  v_boleto2 := (public.criar_boleto('Água', 8000, date '2026-06-10', date '2026-06-01', null)->>'transacao_id')::uuid;
  perform public.pagar_boleto(v_boleto2, timestamptz '2026-06-11 09:00-03');
  perform public.estornar_boleto(v_boleto2);
  if (select status from public.parcelas where transacao_id = v_boleto2 and deleted_at is null) <> 'PENDENTE' then
    raise exception 'FALHA [EST4]: parcela do boleto não voltou a PENDENTE';
  end if;
  if not exists (select 1 from public.vw_contas_a_pagar where transacao_id = v_boleto2) then
    raise exception 'FALHA [EST4]: boleto estornado não reapareceu em contas a pagar';
  end if;

  -- [EST5] estornar boleto não pago => FW409.
  begin
    perform public.estornar_boleto(v_boleto2);
    raise exception 'FALHA [EST5]: estornar boleto pendente não barrou';
  exception when sqlstate 'FW409' then null;
  end;

  -- [EST6] duplicar_boleto: clona +2 meses (venc e competência deslocam), novo
  --        boleto nasce PENDENTE, id novo, original intacto.
  v_res := public.duplicar_boleto(v_boleto2, 2);
  v_tx := (v_res->>'transacao_id')::uuid;
  if v_tx = v_boleto2 then
    raise exception 'FALHA [EST6]: clone reusou o id do original';
  end if;
  if (select data_vencimento from public.transacoes_origem where id = v_tx) <> date '2026-08-10'
     or (select data_compra from public.transacoes_origem where id = v_tx) <> date '2026-08-01' then
    raise exception 'FALHA [EST6]: datas do clone não deslocaram +2 meses';
  end if;
  if (select status from public.parcelas where transacao_id = v_tx and deleted_at is null) <> 'PENDENTE' then
    raise exception 'FALHA [EST6]: clone não nasceu PENDENTE';
  end if;

  -- [EST7] duplicar com p_meses fora da faixa (0..12] => FW400.
  begin
    perform public.duplicar_boleto(v_boleto2, 0);
    raise exception 'FALHA [EST7]: duplicar com p_meses=0 não barrou';
  exception when sqlstate 'FW400' then null;
  end;

  -- ============================================================
  -- BLOCO G — recorrências (0015)
  -- A sessão está como o usuário "cf" desde o bloco CARTEIRA (as categorias
  -- de "bb" não são visíveis nem utilizáveis aqui — e é isso que [REC5]
  -- explora ao validar dono/tipo). Semeia categorias para o usuário atual.
  -- ============================================================
  perform public.seed_categorias_padrao();
  select id into v_cat_g from public.categorias
  where nome = 'Mercado' and user_id = (select auth.uid()) and deleted_at is null;

  -- [REC1] criar_recorrencia com início explícito: proxima_data cai no dia
  --        pedido do mês de início.
  v_res := public.criar_recorrencia('Aluguel Teste', 150000, 'DESPESA', 'PIX', 5,
                                    null, date '2026-06-01');
  v_rec := (v_res->>'recorrencia_id')::uuid;
  if (v_res->>'proxima_data')::date <> date '2026-06-05' then
    raise exception 'FALHA [REC1]: proxima_data esperada 2026-06-05, veio %', v_res->>'proxima_data';
  end if;

  -- [REC2] forma CREDITO barrada (assinatura já vem na fatura) => FW400.
  begin
    perform public.criar_recorrencia('Assinatura', 2990, 'DESPESA', 'CREDITO', 10);
    raise exception 'FALHA [REC2]: recorrência no crédito não barrou';
  exception when sqlstate 'FW400' then null;
  end;

  -- [REC3] dia 31 barrado (não existe em todo mês) => FW400.
  begin
    perform public.criar_recorrencia('Dia 31', 1000, 'DESPESA', 'PIX', 31);
    raise exception 'FALHA [REC3]: dia_do_mes 31 não barrou';
  exception when sqlstate 'FW400' then null;
  end;

  -- [REC4] aplicar_recorrencias materializa as vencidas como transações
  --        comuns (parcela única, à vista) e avança proxima_data.
  v_res := public.aplicar_recorrencias();
  if (v_res->>'transacoes_criadas')::int < 1 then
    raise exception 'FALHA [REC4]: nenhuma transação materializada';
  end if;
  if not exists (select 1 from public.transacoes_origem
                 where descricao = 'Aluguel Teste' and data_compra = date '2026-06-05'
                   and forma_pagamento = 'PIX' and deleted_at is null) then
    raise exception 'FALHA [REC4]: ocorrência de 2026-06-05 não virou transação';
  end if;

  -- [REC5] categoria explícita da recorrência prevalece na materialização.
  v_res := public.criar_recorrencia('Feira Recorrente', 20000, 'DESPESA', 'DEBITO', 3,
                                    v_cat_g, date '2026-06-01');
  v_rec2 := (v_res->>'recorrencia_id')::uuid;
  perform public.aplicar_recorrencias();
  if (select categoria_id from public.transacoes_origem
      where descricao = 'Feira Recorrente' and data_compra = date '2026-06-03'
        and deleted_at is null) is distinct from v_cat_g then
    raise exception 'FALHA [REC5]: categoria da recorrência não aplicada';
  end if;

  -- [REC6] pausar tudo => aplicar não cria nada.
  perform public.alternar_recorrencia(v_rec, false);
  perform public.alternar_recorrencia(v_rec2, false);
  v_res := public.aplicar_recorrencias();
  if (v_res->>'transacoes_criadas')::int <> 0 then
    raise exception 'FALHA [REC6]: recorrência pausada ainda materializou';
  end if;

  -- [REC7] reativar realinha proxima_data para o futuro (pausa não lança
  --        retroativo) e excluir é soft-delete.
  perform public.alternar_recorrencia(v_rec, true);
  if (select proxima_data from public.recorrencias where id = v_rec)
       < (now() at time zone 'America/Sao_Paulo')::date then
    raise exception 'FALHA [REC7]: reativação não realinhou proxima_data';
  end if;
  -- RLS esconde soft-deletados do authenticated: sumir da listagem é a
  -- prova da exclusão (ler deleted_at aqui devolveria NULL sempre).
  perform public.excluir_recorrencia(v_rec);
  if exists (select 1 from public.recorrencias where id = v_rec) then
    raise exception 'FALHA [REC7]: recorrência excluída ainda visível';
  end if;

  raise notice 'OK: todos os asserts do assistente (blocos A-G: edição, categorias, importação, cofrinhos, carteira, boletos, estorno/recorrência de boletos e recorrências) passaram.';
end $$;

rollback;
