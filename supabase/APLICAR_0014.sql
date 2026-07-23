-- =====================================================================
-- 0014_estorno_recorrencia_cron.sql
-- Fecha três lacunas de PROCESSO apontadas na auditoria:
--
--   P1  fechar_faturas existe (0006) mas nada a agenda: em produção as
--       faturas ficam eternamente ABERTA. Aqui agendamos no pg_cron (diário).
--       O bloco é GUARDADO por disponibilidade da extensão — no Postgres de
--       teste (sem pg_cron) ele é ignorado; no Supabase ele agenda.
--
--   P2  "Desfazer pagamento": pagar fatura/boleto por engano não tinha
--       estorno de 1 clique. estornar_pagamento_fatura e estornar_boleto são
--       simétricos a processar_pagamento_fatura (0003) e pagar_boleto (0013).
--
--   P2  Recorrência de boleto: gasto fixo mensal (luz/água) era relançado à
--       mão. duplicar_boleto clona o boleto para o(s) mês(es) seguinte(s) —
--       o "relançar mês que vem" de 1 clique (caminho mínimo; série completa
--       fica para depois).
--
-- Padrões do projeto: RPC SECURITY DEFINER + search_path='' + escopo
-- auth.uid() em toda query + FW4xx com hint. DML direto continua revogado.
-- =====================================================================

-- ------------------- 1. ESTORNO DE PAGAMENTO DE FATURA -------------------
-- Simétrico a processar_pagamento_fatura: PAGA -> volta ao estado de ciclo
-- (ABERTA/FECHADA) que a fatura teria HOJE, e as parcelas voltam a PENDENTE.
-- Reconstrói o status pelo mesmo corte de fechar_faturas (0006) porque o
-- estado anterior (ABERTA vs FECHADA) não é persistido: recomputar é correto,
-- reverter cego para ABERTA mentiria numa fatura já vencida.
create or replace function public.estornar_pagamento_fatura(
  p_fatura_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id     uuid := auth.uid();
  v_fatura      public.faturas%rowtype;
  v_fechamento  int;
  v_corte       date;
  v_novo_status text;
  v_estornadas  int;
begin
  if v_user_id is null then
    raise exception 'Não autenticado.'
      using errcode = 'FW401', hint = 'Sessão ausente/expirada. Não retente; reautentique.';
  end if;
  if p_fatura_id is null then
    raise exception 'p_fatura_id é obrigatório.'
      using errcode = 'FW400', hint = 'Informe o uuid da fatura.';
  end if;

  select * into v_fatura
  from public.faturas
  where id = p_fatura_id and user_id = v_user_id and deleted_at is null
  for update;
  if not found then
    raise exception 'Fatura % não encontrada para este usuário.', p_fatura_id
      using errcode = 'FW404', hint = 'Confira o id; a fatura pode estar soft-deletada.';
  end if;
  if v_fatura.status <> 'PAGA' then
    raise exception 'Fatura % não está PAGA — nada a estornar.', p_fatura_id
      using errcode = 'FW409', hint = 'Só faturas PAGAS podem ser estornadas.';
  end if;

  -- Corte da competência = dia de fechamento clampado ao último dia do mês
  -- (mesma conta de fechar_faturas). Fatura cujo corte já passou = FECHADA.
  select least(c.dia_fechamento,
               extract(day from (v_fatura.competencia + interval '1 month - 1 day'))::int)
    into v_fechamento
  from public.cartoes_credito c
  where c.id = v_fatura.cartao_id;

  v_corte := (v_fatura.competencia + (coalesce(v_fechamento, 1) - 1) * interval '1 day')::date;
  v_novo_status := case
    when v_corte <= (now() at time zone 'America/Sao_Paulo')::date then 'FECHADA'
    else 'ABERTA'
  end;

  update public.faturas
     set status = v_novo_status, updated_at = now()
   where id = v_fatura.id;

  update public.parcelas
     set status = 'PENDENTE',
         data_pagamento = null,
         updated_at = now()
   where fatura_id = v_fatura.id
     and user_id = v_user_id
     and deleted_at is null
     and status = 'PAGA';
  get diagnostics v_estornadas = row_count;

  return jsonb_build_object(
    'fatura_id',          v_fatura.id,
    'status',             v_novo_status,
    'parcelas_estornadas', v_estornadas);
end;
$$;

-- ------------------- 2. ESTORNO DE PAGAMENTO DE BOLETO -------------------
-- Simétrico a pagar_boleto (0013): PAGA -> PENDENTE, some data_pagamento.
-- O valor volta para vw_carteira (sai de boletos_pagos) e o boleto reaparece
-- em vw_contas_a_pagar.
create or replace function public.estornar_boleto(
  p_transacao_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_t       public.transacoes_origem%rowtype;
  v_parcela public.parcelas%rowtype;
begin
  if v_user_id is null then
    raise exception 'Não autenticado.'
      using errcode = 'FW401', hint = 'Sessão ausente/expirada. Não retente; reautentique.';
  end if;
  if p_transacao_id is null then
    raise exception 'p_transacao_id é obrigatório.'
      using errcode = 'FW400', hint = 'Informe o uuid do boleto.';
  end if;

  select * into v_t
  from public.transacoes_origem
  where id = p_transacao_id and user_id = v_user_id and deleted_at is null
    and forma_pagamento = 'BOLETO'
  for update;
  if not found then
    raise exception 'Boleto % não encontrado para este usuário.', p_transacao_id
      using errcode = 'FW404', hint = 'Confira o id; o boleto pode estar excluído ou não ser BOLETO.';
  end if;

  select * into v_parcela
  from public.parcelas
  where transacao_id = v_t.id and user_id = v_user_id and deleted_at is null
  for update;
  if not found then
    raise exception 'Boleto % sem parcela ativa.', p_transacao_id
      using errcode = 'FW500', hint = 'Falha interna; reporte com a mensagem completa.';
  end if;
  if v_parcela.status <> 'PAGA' then
    raise exception 'Boleto % não está PAGO — nada a estornar.', p_transacao_id
      using errcode = 'FW409', hint = 'Só boletos PAGOS podem ser estornados.';
  end if;

  update public.parcelas
     set status = 'PENDENTE', data_pagamento = null
   where id = v_parcela.id;

  return jsonb_build_object(
    'transacao_id', v_t.id,
    'status',       'A_PAGAR');
end;
$$;

-- ------------------- 3. RECORRÊNCIA: duplicar_boleto -------------------
-- Clona um boleto para +N meses (vencimento e competência avançam N meses,
-- valor/descrição/categoria copiados). Novo boleto nasce PENDENTE. É o
-- "relançar a conta de luz do mês que vem" de 1 clique. Boleto PAGO também
-- pode ser duplicado (o pago é histórico; o clone é a próxima conta).
create or replace function public.duplicar_boleto(
  p_transacao_id uuid,
  p_meses        int default 1   -- quantos meses à frente (1 = próximo mês)
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id      uuid := auth.uid();
  v_src          public.transacoes_origem%rowtype;
  v_venc         date;
  v_comp         date;
  v_novo_id      uuid;
begin
  if v_user_id is null then
    raise exception 'Não autenticado.'
      using errcode = 'FW401', hint = 'Sessão ausente/expirada. Não retente; reautentique.';
  end if;
  if p_transacao_id is null then
    raise exception 'p_transacao_id é obrigatório.'
      using errcode = 'FW400', hint = 'Informe o uuid do boleto de origem.';
  end if;
  if p_meses is null or p_meses < 1 or p_meses > 12 then
    raise exception 'p_meses deve estar entre 1 e 12. Recebido: %', p_meses
      using errcode = 'FW400', hint = 'Use um deslocamento de 1 a 12 meses.';
  end if;

  select * into v_src
  from public.transacoes_origem
  where id = p_transacao_id and user_id = v_user_id and deleted_at is null
    and forma_pagamento = 'BOLETO'
  for update;
  if not found then
    raise exception 'Boleto % não encontrado para este usuário.', p_transacao_id
      using errcode = 'FW404', hint = 'Confira o id; o boleto pode estar excluído ou não ser BOLETO.';
  end if;

  v_venc := (v_src.data_vencimento + (p_meses || ' months')::interval)::date;
  v_comp := (v_src.data_compra     + (p_meses || ' months')::interval)::date;

  -- Mesma janela de plausibilidade de criar_boleto (0013): +5 anos venc,
  -- +1 ano competência. Deslocar 12 meses não estoura, mas guardamos igual.
  if v_venc > (now() at time zone 'America/Sao_Paulo')::date + interval '5 years' then
    raise exception 'vencimento do clone fora do intervalo plausível: %', v_venc
      using errcode = 'FW400', hint = 'Reduza o deslocamento de meses.';
  end if;
  if v_comp > (now() at time zone 'America/Sao_Paulo')::date + interval '1 year' then
    raise exception 'competência do clone fora do intervalo plausível: %', v_comp
      using errcode = 'FW400', hint = 'Reduza o deslocamento de meses.';
  end if;

  insert into public.transacoes_origem
    (user_id, descricao, valor_total, tipo, forma_pagamento, cartao_id,
     data_compra, num_parcelas, data_vencimento, categoria_id)
  values
    (v_user_id, v_src.descricao, v_src.valor_total, 'DESPESA', 'BOLETO', null,
     v_comp, 1, v_venc, v_src.categoria_id)  -- categoria copiada; trigger só age se null
  returning id into v_novo_id;

  insert into public.parcelas
    (user_id, transacao_id, fatura_id, numero, valor, data_competencia)
  values
    (v_user_id, v_novo_id, null, 1, v_src.valor_total, v_comp);

  return jsonb_build_object(
    'transacao_id',    v_novo_id,
    'data_vencimento', v_venc,
    'competencia',     v_comp,
    'status',          'A_PAGAR');
end;
$$;

-- ------------------- 4. PRIVILÉGIOS DAS RPCs -------------------
revoke execute on function public.estornar_pagamento_fatura(uuid) from public, anon;
revoke execute on function public.estornar_boleto(uuid)           from public, anon;
revoke execute on function public.duplicar_boleto(uuid, int)      from public, anon;
grant  execute on function public.estornar_pagamento_fatura(uuid) to authenticated;
grant  execute on function public.estornar_boleto(uuid)           to authenticated;
grant  execute on function public.duplicar_boleto(uuid, int)      to authenticated;

-- ------------------- 5. AGENDAMENTO DIÁRIO DE fechar_faturas (P1) -------------------
-- fechar_faturas (0006) é administrativa (fecha TODOS os usuários) e não pode
-- ser chamada por cliente. pg_cron a roda como owner (postgres/superuser), que
-- tem execute. Cron do Supabase usa UTC: 06:10 UTC ≈ 03:10 America/Sao_Paulo.
--
-- Bloco guardado: só executa onde pg_cron está DISPONÍVEL (Supabase). No
-- Postgres da suite local a extensão não existe -> o if é falso e nada roda,
-- então as migrações continuam aplicáveis em qualquer ambiente. execute
-- dinâmico evita qualquer dependência de parse do schema `cron`.
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    execute 'create extension if not exists pg_cron';
    -- Remove agendamento anterior (idempotente): sem linha em cron.job, o
    -- select não chama unschedule e não há erro "job not found".
    execute $q$
      select cron.unschedule(jobid)
      from cron.job
      where jobname = 'fechar-faturas-diario'
    $q$;
    execute $q$
      select cron.schedule(
        'fechar-faturas-diario',
        '10 6 * * *',
        'select public.fechar_faturas();'
      )
    $q$;
  end if;
end $$;
