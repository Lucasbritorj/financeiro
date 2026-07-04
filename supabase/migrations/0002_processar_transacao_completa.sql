-- =====================================================================
-- processar_transacao_completa
-- SECURITY DEFINER: as tabelas têm DML revogado para 'authenticated' (0005);
-- esta função é a ÚNICA porta de escrita. O escopo é garantido em código:
-- usuário vem de auth.uid(), nunca do cliente, e toda query filtra/insere
-- user_id = v_user_id. search_path vazio mitiga hijacking.
-- Função PL/pgSQL é atômica: qualquer RAISE reverte tudo.
-- Erros: SQLSTATE estável (FW4xx/FW500) + hint com remediação.
-- =====================================================================
create or replace function public.processar_transacao_completa(
  p_descricao       text,
  p_valor_total     bigint,             -- centavos
  p_tipo            text,               -- DESPESA | RECEITA
  p_forma_pagamento text,               -- CREDITO | DEBITO | PIX | DINHEIRO
  p_cartao_id       uuid default null,
  p_data_compra     date default null,  -- default: hoje em America/Sao_Paulo
  p_num_parcelas    int  default 1
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id       uuid := auth.uid();
  v_data_compra   date := coalesce(p_data_compra,
                                   (now() at time zone 'America/Sao_Paulo')::date);
  v_cartao        public.cartoes_credito%rowtype;
  v_transacao_id  uuid;
  v_dia_fech      int;
  v_primeira_comp date;
  v_valor_base    bigint;
  v_resto         bigint;
  v_comprometido  bigint;
  v_comp_travada  date;
  v_status_trava  text;
  v_criadas       int;
  v_soma          bigint;
begin
  -- ===== Validações =====
  if v_user_id is null then
    raise exception 'Não autenticado.'
      using errcode = 'FW401', hint = 'Sessão ausente/expirada. Não retente; reautentique.';
  end if;
  if coalesce(trim(p_descricao), '') = '' then
    raise exception 'descricao é obrigatória.'
      using errcode = 'FW400', hint = 'Informe uma descrição e chame novamente.';
  end if;
  if p_valor_total is null or p_valor_total <= 0 then
    raise exception 'valor_total deve ser positivo, em centavos. Recebido: %', p_valor_total
      using errcode = 'FW400', hint = 'Envie o valor em centavos (inteiro > 0).';
  end if;
  if p_tipo not in ('DESPESA','RECEITA') then
    raise exception 'tipo inválido: %', p_tipo
      using errcode = 'FW400', hint = 'Use DESPESA ou RECEITA.';
  end if;
  if p_forma_pagamento not in ('CREDITO','DEBITO','PIX','DINHEIRO') then
    raise exception 'forma_pagamento inválida: %', p_forma_pagamento
      using errcode = 'FW400', hint = 'Use CREDITO, DEBITO, PIX ou DINHEIRO.';
  end if;
  -- Teto no servidor: a UI limita 48, mas validação de limites não confia
  -- no cliente — chamada direta à RPC não pode inflar faturas sem teto.
  if coalesce(p_num_parcelas, 0) < 1 or p_num_parcelas > 120 then
    raise exception 'Número de parcelas inválido: %. Mínimo 1, máximo 120.', p_num_parcelas
      using errcode = 'FW400', hint = 'Ajuste num_parcelas para o intervalo [1, 120].';
  end if;

  -- ===== Fluxo não-CREDITO: transação + parcela única (fluxo de caixa) =====
  if p_forma_pagamento <> 'CREDITO' then
    if p_num_parcelas <> 1 then
      raise exception 'Parcelamento só é permitido para CREDITO.'
        using errcode = 'FW400', hint = 'Use num_parcelas = 1 ou forma_pagamento = CREDITO.';
    end if;

    insert into public.transacoes_origem
      (user_id, descricao, valor_total, tipo, forma_pagamento, cartao_id, data_compra, num_parcelas)
    values
      (v_user_id, p_descricao, p_valor_total, p_tipo, p_forma_pagamento, null, v_data_compra, 1)
    returning id into v_transacao_id;

    insert into public.parcelas
      (user_id, transacao_id, fatura_id, numero, valor, data_competencia)
    values
      (v_user_id, v_transacao_id, null, 1, p_valor_total, v_data_compra);

    return jsonb_build_object(
      'transacao_id', v_transacao_id, 'parcelas_criadas', 1, 'faturas_afetadas', 0);
  end if;

  -- ===== Fluxo CREDITO =====
  if p_cartao_id is null then
    raise exception 'CREDITO exige cartao_id.'
      using errcode = 'FW400', hint = 'Informe o uuid do cartão.';
  end if;
  if p_num_parcelas > p_valor_total then
    raise exception 'num_parcelas (%) maior que o valor em centavos (%): haveria parcela de 0.',
      p_num_parcelas, p_valor_total
      using errcode = 'FW400', hint = 'Reduza num_parcelas ou aumente o valor.';
  end if;

  -- FOR UPDATE serializa transações concorrentes do mesmo cartão: sem o lock,
  -- duas chamadas simultâneas passariam ambas pelo guard de limite.
  select * into v_cartao
  from public.cartoes_credito
  where id = p_cartao_id and user_id = v_user_id and deleted_at is null
  for update;
  if not found then
    raise exception 'Cartão % não encontrado para este usuário.', p_cartao_id
      using errcode = 'FW404', hint = 'Confira o id; o cartão pode estar soft-deletado ou ser de outro usuário.';
  end if;

  -- Corte de fechamento: dia efetivo = LEAST(dia, último dia do mês da compra);
  -- compra em dia >= fechamento entra na competência do mês seguinte.
  v_dia_fech := least(
    v_cartao.dia_fechamento,
    extract(day from (date_trunc('month', v_data_compra) + interval '1 month - 1 day'))::int);
  if extract(day from v_data_compra)::int >= v_dia_fech then
    v_primeira_comp := (date_trunc('month', v_data_compra) + interval '1 month')::date;
  else
    v_primeira_comp := date_trunc('month', v_data_compra)::date;
  end if;

  -- Guard de limite: comprometido = parcelas PENDENTES ativas de DESPESA do
  -- cartão (parcelas não têm cartao_id — join via transacoes_origem).
  -- RECEITA (estorno) não consome limite. Cartão já lockado (FOR UPDATE acima).
  if p_tipo = 'DESPESA' then
    select coalesce(sum(p.valor), 0) into v_comprometido
    from public.parcelas p
    join public.transacoes_origem t on t.id = p.transacao_id
    where t.cartao_id = v_cartao.id
      and t.user_id = v_user_id  -- defesa em profundidade (DEFINER bypassa RLS)
      and t.tipo = 'DESPESA'
      and t.deleted_at is null
      and p.status = 'PENDENTE'
      and p.deleted_at is null;
    if v_comprometido + p_valor_total > v_cartao.limite_total then
      raise exception 'Limite de crédito excedido: comprometido % + novo % > limite % (centavos).',
        v_comprometido, p_valor_total, v_cartao.limite_total
        using errcode = 'FW429',
              hint = 'Pague faturas pendentes ou reduza o valor. Não repita a chamada com os mesmos argumentos.';
    end if;
  end if;

  -- Fail fast: nenhuma competência do parcelamento pode cair em fatura já
  -- liquidada (PAGA) ou fechada — pagamento antecipado não reabre o ciclo.
  -- Checado ANTES de qualquer INSERT: erro claro em vez de falha genérica
  -- de integridade no fim do fluxo.
  select f.competencia, f.status
    into v_comp_travada, v_status_trava
  from public.faturas f
  join generate_series(1, p_num_parcelas) as n
    on f.competencia = (v_primeira_comp + make_interval(months => n - 1))::date
  where f.cartao_id = v_cartao.id
    and f.deleted_at is null
    and f.status <> 'ABERTA'
  order by f.competencia
  limit 1;
  if found then
    raise exception 'Fatura de % já está % — impossível alocar novos gastos nesta competência.',
      to_char(v_comp_travada, 'MM/YYYY'), v_status_trava
      using errcode = 'FW409',
            hint = 'Lance a compra com outra data (próximo ciclo) ou em outro cartão.';
  end if;

  insert into public.transacoes_origem
    (user_id, descricao, valor_total, tipo, forma_pagamento, cartao_id, data_compra, num_parcelas)
  values
    (v_user_id, p_descricao, p_valor_total, p_tipo, 'CREDITO', p_cartao_id, v_data_compra, p_num_parcelas)
  returning id into v_transacao_id;

  -- Divisão centesimal sem sobras: floor em todas, resto na 1ª parcela.
  v_valor_base := p_valor_total / p_num_parcelas;
  v_resto      := p_valor_total - (v_valor_base * p_num_parcelas);

  -- Faturas futuras: idempotente e à prova de corrida (UNIQUE + ON CONFLICT).
  -- Vencimento no mês seguinte à competência quando dia_vencimento <= dia_fechamento;
  -- dia clampado ao último dia do mês-alvo (Falha do Dia 31).
  insert into public.faturas (user_id, cartao_id, competencia, data_vencimento)
  select v_user_id, v_cartao.id, m.competencia,
         (m.mes_venc + (least(v_cartao.dia_vencimento,
              extract(day from (m.mes_venc + interval '1 month - 1 day'))::int) - 1)
            * interval '1 day')::date
  from (
    select c.competencia,
           case when v_cartao.dia_vencimento <= v_cartao.dia_fechamento
                then (c.competencia + interval '1 month')::date
                else c.competencia end as mes_venc
    from (select (v_primeira_comp + make_interval(months => n - 1))::date as competencia
          from generate_series(1, p_num_parcelas) as n) c
  ) m
  -- Predicado no árbitro: casa tanto a constraint total antiga quanto o índice
  -- parcial de 0004 (faturas ativas). Sem ele, a RPC quebra após a migração 0004.
  on conflict (cartao_id, competencia) where deleted_at is null do nothing;

  -- Parcelas (set-based); só entram em fatura ABERTA.
  insert into public.parcelas
    (user_id, transacao_id, fatura_id, numero, valor, data_competencia)
  select v_user_id, v_transacao_id, f.id, s.n,
         v_valor_base + case when s.n = 1 then v_resto else 0 end,
         s.competencia
  from (select n, (v_primeira_comp + make_interval(months => n - 1))::date as competencia
        from generate_series(1, p_num_parcelas) as n) s
  join public.faturas f
    on f.cartao_id = v_cartao.id
   and f.user_id = v_user_id  -- defesa em profundidade (DEFINER bypassa RLS)
   and f.competencia = s.competencia
   and f.status = 'ABERTA'
   and f.deleted_at is null;

  get diagnostics v_criadas = row_count;
  if v_criadas <> p_num_parcelas then
    raise exception 'Integridade violada: % de % parcelas criadas (fatura FECHADA/PAGA no intervalo?).',
      v_criadas, p_num_parcelas
      using errcode = 'FW500', hint = 'Falha interna; não retente e reporte com a mensagem completa.';
  end if;

  -- Invariante de auditoria: SUM(parcelas) = valor_total.
  select sum(valor) into v_soma
  from public.parcelas where transacao_id = v_transacao_id;
  if v_soma is distinct from p_valor_total then
    raise exception 'Invariante centesimal violada: soma % <> total %.', v_soma, p_valor_total
      using errcode = 'FW500', hint = 'Falha interna; não retente e reporte com a mensagem completa.';
  end if;

  return jsonb_build_object(
    'transacao_id',     v_transacao_id,
    'parcelas_criadas', v_criadas,
    'faturas_afetadas', v_criadas);
end;
$$;
