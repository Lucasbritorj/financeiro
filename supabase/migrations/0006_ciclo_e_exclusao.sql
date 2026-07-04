-- =====================================================================
-- 0006_ciclo_e_exclusao.sql
-- Completa a API de escrita do backend (pós-0005 o DML direto é revogado,
-- então SEM estas RPCs não existe caminho de exclusão) e liga o ciclo de
-- vida da fatura (ABERTA -> FECHADA), até aqui morto.
--
-- Conteúdo:
--   1. updated_at universal + trigger genérico (nenhuma RPC precisa lembrar).
--   2. excluir_transacao — soft delete com cascata (trigger de 0001).
--   3. excluir_cartao   — soft delete guardado por pendências.
--   4. fechar_faturas   — transição ABERTA -> FECHADA (pg_cron/admin).
-- Erros seguem o padrão FW4xx + hint (ver CLAUDE.md).
-- =====================================================================

-- ------------------- 1. updated_at UNIVERSAL -------------------
-- faturas/parcelas já têm (0003); cartões e transações ganham agora.
alter table public.cartoes_credito   add column if not exists updated_at timestamptz not null default now();
alter table public.transacoes_origem add column if not exists updated_at timestamptz not null default now();

-- Trigger genérico: updated_at deixa de depender de cada RPC setar à mão.
create or replace function public.fn_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  -- clock_timestamp(), não now(): now() congela no início da transação e
  -- deixaria updated_at indistinguível de created_at em fluxos batch/teste.
  new.updated_at := clock_timestamp();
  return new;
end;
$$;
revoke execute on function public.fn_touch_updated_at() from public, anon, authenticated;

do $$
declare
  t text;
begin
  foreach t in array array['cartoes_credito','faturas','transacoes_origem','parcelas'] loop
    execute format('drop trigger if exists trg_touch_updated_at on public.%I', t);
    execute format(
      'create trigger trg_touch_updated_at before update on public.%I
         for each row execute function public.fn_touch_updated_at()', t);
  end loop;
end $$;

-- ------------------- 2. EXCLUSÃO SOFT DE TRANSAÇÃO -------------------
-- Cascata para as parcelas é do trigger trg_transacao_soft_delete (0001).
-- Transação com parcela PAGA não se exclui — histórico contábil se estorna
-- (lançar RECEITA), nunca se apaga.
create or replace function public.excluir_transacao(p_transacao_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_transacao public.transacoes_origem%rowtype;
  v_afetadas int;
begin
  if v_user_id is null then
    raise exception 'Não autenticado.'
      using errcode = 'FW401', hint = 'Sessão ausente/expirada. Não retente; reautentique.';
  end if;
  if p_transacao_id is null then
    raise exception 'p_transacao_id é obrigatório.'
      using errcode = 'FW400', hint = 'Informe o uuid da transação.';
  end if;

  select * into v_transacao
  from public.transacoes_origem
  where id = p_transacao_id and user_id = v_user_id and deleted_at is null
  for update;
  if not found then
    raise exception 'Transação % não encontrada para este usuário.', p_transacao_id
      using errcode = 'FW404', hint = 'Confira o id; a transação pode já estar excluída.';
  end if;

  if exists (select 1 from public.parcelas
             where transacao_id = v_transacao.id
               and user_id = v_user_id
               and status = 'PAGA'
               and deleted_at is null) then
    raise exception 'Transação % tem parcela PAGA — não pode ser excluída.', p_transacao_id
      using errcode = 'FW409', hint = 'Histórico pago não se apaga; lance um estorno (RECEITA) no cartão.';
  end if;

  select count(*) into v_afetadas
  from public.parcelas
  where transacao_id = v_transacao.id and user_id = v_user_id and deleted_at is null;

  update public.transacoes_origem
     set deleted_at = now()
   where id = v_transacao.id;  -- trigger cascateia parcelas

  return jsonb_build_object(
    'transacao_id',      v_transacao.id,
    'parcelas_afetadas', v_afetadas);
end;
$$;

-- ------------------- 3. EXCLUSÃO SOFT DE CARTÃO -------------------
create or replace function public.excluir_cartao(p_cartao_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_cartao public.cartoes_credito%rowtype;
begin
  if v_user_id is null then
    raise exception 'Não autenticado.'
      using errcode = 'FW401', hint = 'Sessão ausente/expirada. Não retente; reautentique.';
  end if;
  if p_cartao_id is null then
    raise exception 'p_cartao_id é obrigatório.'
      using errcode = 'FW400', hint = 'Informe o uuid do cartão.';
  end if;

  select * into v_cartao
  from public.cartoes_credito
  where id = p_cartao_id and user_id = v_user_id and deleted_at is null
  for update;
  if not found then
    raise exception 'Cartão % não encontrado para este usuário.', p_cartao_id
      using errcode = 'FW404', hint = 'Confira o id; o cartão pode já estar excluído.';
  end if;

  if exists (select 1
             from public.parcelas p
             join public.transacoes_origem t on t.id = p.transacao_id
             where t.cartao_id = v_cartao.id
               and t.user_id = v_user_id
               and p.status = 'PENDENTE'
               and p.deleted_at is null
               and t.deleted_at is null) then
    raise exception 'Cartão % tem parcelas pendentes — quite as faturas antes de excluí-lo.', p_cartao_id
      using errcode = 'FW409', hint = 'Pague as faturas em aberto ou exclua as transações pendentes.';
  end if;

  update public.cartoes_credito
     set deleted_at = now()
   where id = v_cartao.id;

  -- Transações/faturas históricas permanecem: exclusão de cartão não apaga extrato.
  return jsonb_build_object('cartao_id', v_cartao.id);
end;
$$;

-- ------------------- 4. FECHAMENTO DE CICLO -------------------
-- Fatura da competência M está completa no dia de fechamento de M (compra
-- em dia >= fechamento já nasce em M+1, regra de 0002). Fecha tudo que
-- venceu o corte até p_referencia. Administrativa: fecha faturas de TODOS
-- os usuários — por isso nenhum role de cliente pode executá-la; agende no
-- pg_cron (diário) ou rode no SQL Editor.
create or replace function public.fechar_faturas(
  p_referencia date default (now() at time zone 'America/Sao_Paulo')::date
)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_fechadas int;
begin
  update public.faturas f
     set status = 'FECHADA'
    from public.cartoes_credito c
   where c.id = f.cartao_id
     and f.status = 'ABERTA'
     and f.deleted_at is null
     -- corte efetivo da competência: dia de fechamento clampado ao último dia do mês
     and (f.competencia
          + (least(c.dia_fechamento,
                   extract(day from (f.competencia + interval '1 month - 1 day'))::int) - 1)
          * interval '1 day')::date <= p_referencia;
  get diagnostics v_fechadas = row_count;
  return v_fechadas;
end;
$$;

-- ------------------- PRIVILÉGIOS -------------------
revoke execute on function public.excluir_transacao(uuid) from public, anon;
revoke execute on function public.excluir_cartao(uuid)    from public, anon;
grant  execute on function public.excluir_transacao(uuid) to authenticated;
grant  execute on function public.excluir_cartao(uuid)    to authenticated;
-- fechar_faturas é global: nem authenticated executa.
revoke execute on function public.fechar_faturas(date) from public, anon, authenticated;
