-- =====================================================================
-- 0007_editar_transacao.sql
-- Edição de lançamento (descrição, valor, data). Até aqui o app só
-- criava/excluía — corrigir um typo exigia excluir e relançar.
--
-- Regras:
--   * Parcela PAGA em qualquer número => FW409 (histórico se estorna).
--   * Parcela em fatura FECHADA/PAGA  => FW409 (ciclo liquidado não reabre).
--   * Valor novo redistribui nas parcelas existentes: base = total DIV n,
--     resto na 1ª parcela (mesma regra centesimal de 0002).
--   * Aumento de valor em CREDITO/DESPESA repassa o guard de limite.
--   * Data nova: livre fora do crédito; no crédito só se a competência da
--     1ª parcela não mudar (mudança de ciclo = excluir e relançar — a
--     realocação de faturas tem regras demais para uma edição implícita).
-- Padrões do projeto: DEFINER + search_path='' + escopo auth.uid() em
-- toda query + FW4xx com hint. updated_at é do trigger (0006).
-- =====================================================================
create or replace function public.editar_transacao(
  p_transacao_id uuid,
  p_descricao    text   default null,   -- null = mantém
  p_valor_total  bigint default null,   -- centavos; null = mantém
  p_data_compra  date   default null    -- null = mantém
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id      uuid := auth.uid();
  v_t            public.transacoes_origem%rowtype;
  v_cartao       public.cartoes_credito%rowtype;
  v_valor        bigint;
  v_data         date;
  v_base         bigint;
  v_resto        bigint;
  v_comprometido bigint;
  v_dia_fech     int;
  v_comp_nova    date;
  v_comp_atual   date;
  v_soma         bigint;
  v_atualizadas  int := 0;
begin
  if v_user_id is null then
    raise exception 'Não autenticado.'
      using errcode = 'FW401', hint = 'Sessão ausente/expirada. Não retente; reautentique.';
  end if;
  if p_transacao_id is null then
    raise exception 'p_transacao_id é obrigatório.'
      using errcode = 'FW400', hint = 'Informe o uuid da transação.';
  end if;
  if p_descricao is null and p_valor_total is null and p_data_compra is null then
    raise exception 'Nada a editar.'
      using errcode = 'FW400', hint = 'Informe ao menos um campo (descrição, valor ou data).';
  end if;

  select * into v_t
  from public.transacoes_origem
  where id = p_transacao_id and user_id = v_user_id and deleted_at is null
  for update;
  if not found then
    raise exception 'Transação % não encontrada para este usuário.', p_transacao_id
      using errcode = 'FW404', hint = 'Confira o id; a transação pode estar excluída.';
  end if;

  -- Histórico liquidado é imutável (mesma regra de excluir_transacao).
  if exists (select 1 from public.parcelas
             where transacao_id = v_t.id and user_id = v_user_id
               and status = 'PAGA' and deleted_at is null) then
    raise exception 'Transação % tem parcela PAGA — não pode ser editada.', p_transacao_id
      using errcode = 'FW409', hint = 'Histórico pago não se edita; lance um estorno (RECEITA).';
  end if;
  if exists (select 1
             from public.parcelas p
             join public.faturas f on f.id = p.fatura_id
             where p.transacao_id = v_t.id and p.user_id = v_user_id
               and p.deleted_at is null and f.deleted_at is null
               and f.status <> 'ABERTA') then
    raise exception 'Transação % tem parcela em fatura FECHADA/PAGA.', p_transacao_id
      using errcode = 'FW409', hint = 'Ciclo fechado não reabre; exclua e relance no próximo ciclo, ou estorne.';
  end if;

  v_valor := coalesce(p_valor_total, v_t.valor_total);
  v_data  := coalesce(p_data_compra, v_t.data_compra);

  -- ===== Validações dos campos novos (mesmos limites de 0002) =====
  if p_descricao is not null and coalesce(trim(p_descricao), '') = '' then
    raise exception 'descricao não pode ficar vazia.'
      using errcode = 'FW400', hint = 'Informe uma descrição ou omita o campo.';
  end if;
  if v_valor <= 0 then
    raise exception 'valor_total deve ser positivo, em centavos. Recebido: %', v_valor
      using errcode = 'FW400', hint = 'Envie o valor em centavos (inteiro > 0).';
  end if;
  if v_valor < v_t.num_parcelas then
    raise exception 'valor (%) menor que o número de parcelas (%): haveria parcela de 0.',
      v_valor, v_t.num_parcelas
      using errcode = 'FW400', hint = 'Aumente o valor ou exclua e relance com menos parcelas.';
  end if;
  if v_data > (now() at time zone 'America/Sao_Paulo')::date + 1
     or v_data < date '2000-01-01' then
    raise exception 'data_compra fora do intervalo plausível: %', v_data
      using errcode = 'FW400', hint = 'Use uma data entre 2000-01-01 e amanhã (America/Sao_Paulo).';
  end if;

  -- ===== Guards específicos de CREDITO =====
  if v_t.forma_pagamento = 'CREDITO' then
    select * into v_cartao
    from public.cartoes_credito
    where id = v_t.cartao_id and user_id = v_user_id and deleted_at is null
    for update;  -- serializa com processar_transacao_completa (guard de limite)
    if not found then
      raise exception 'Cartão da transação não está mais ativo.'
        using errcode = 'FW409', hint = 'Cartão excluído: estorne ou exclua a transação.';
    end if;

    -- Mudança de data não pode mudar a competência da 1ª parcela.
    if p_data_compra is not null then
      v_dia_fech := least(
        v_cartao.dia_fechamento,
        extract(day from (date_trunc('month', v_data) + interval '1 month - 1 day'))::int);
      if extract(day from v_data)::int >= v_dia_fech then
        v_comp_nova := (date_trunc('month', v_data) + interval '1 month')::date;
      else
        v_comp_nova := date_trunc('month', v_data)::date;
      end if;
      select min(data_competencia) into v_comp_atual
      from public.parcelas
      where transacao_id = v_t.id and user_id = v_user_id and deleted_at is null;
      if v_comp_nova is distinct from v_comp_atual then
        raise exception 'Nova data move a compra para outra competência (% -> %).',
          to_char(v_comp_atual, 'MM/YYYY'), to_char(v_comp_nova, 'MM/YYYY')
          using errcode = 'FW409',
                hint = 'Realocação de fatura não é edição: exclua a transação e relance com a nova data.';
      end if;
    end if;

    -- Aumento em DESPESA repassa o limite (comprometido SEM esta transação).
    if v_t.tipo = 'DESPESA' and v_valor > v_t.valor_total then
      select coalesce(sum(p.valor), 0) into v_comprometido
      from public.parcelas p
      join public.transacoes_origem t on t.id = p.transacao_id
      where t.cartao_id = v_cartao.id
        and t.user_id = v_user_id
        and t.tipo = 'DESPESA'
        and t.deleted_at is null
        and t.id <> v_t.id
        and p.status = 'PENDENTE'
        and p.deleted_at is null;
      if v_comprometido + v_valor > v_cartao.limite_total then
        raise exception 'Limite de crédito excedido: comprometido % + novo % > limite % (centavos).',
          v_comprometido, v_valor, v_cartao.limite_total
          using errcode = 'FW429',
                hint = 'Pague faturas pendentes ou reduza o valor.';
      end if;
    end if;
  end if;

  -- ===== Aplicação =====
  update public.transacoes_origem
     set descricao   = coalesce(nullif(trim(coalesce(p_descricao, '')), ''), descricao),
         valor_total = v_valor,
         data_compra = v_data
   where id = v_t.id;

  -- Redistribuição centesimal: resto na 1ª parcela (mesma regra de 0002).
  if p_valor_total is not null and p_valor_total <> v_t.valor_total then
    v_base  := v_valor / v_t.num_parcelas;
    v_resto := v_valor - (v_base * v_t.num_parcelas);
    update public.parcelas
       set valor = v_base + case when numero = 1 then v_resto else 0 end
     where transacao_id = v_t.id and user_id = v_user_id and deleted_at is null;
    get diagnostics v_atualizadas = row_count;

    select sum(valor) into v_soma
    from public.parcelas
    where transacao_id = v_t.id and user_id = v_user_id and deleted_at is null;
    if v_soma is distinct from v_valor then
      raise exception 'Invariante centesimal violada: soma % <> total %.', v_soma, v_valor
        using errcode = 'FW500', hint = 'Falha interna; não retente e reporte com a mensagem completa.';
    end if;
  end if;

  -- Fora do crédito a parcela única acompanha a data da compra.
  if p_data_compra is not null and v_t.forma_pagamento <> 'CREDITO' then
    update public.parcelas
       set data_competencia = v_data
     where transacao_id = v_t.id and user_id = v_user_id and deleted_at is null;
  end if;

  return jsonb_build_object(
    'transacao_id',        v_t.id,
    'parcelas_atualizadas', v_atualizadas);
end;
$$;

revoke execute on function public.editar_transacao(uuid, text, bigint, date) from public, anon;
grant  execute on function public.editar_transacao(uuid, text, bigint, date) to authenticated;
