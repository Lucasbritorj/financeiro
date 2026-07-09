-- =====================================================================
-- 0011_substituir_transacao.sql
-- Edição COMPLETA de transação: além de descrição/valor/data (0007), permite
-- trocar tipo (DESPESA/RECEITA), forma de pagamento (CREDITO/DEBITO/PIX/
-- DINHEIRO) e nº de parcelas. Mudar esses campos reestrutura parcelas e
-- faturas e repassa o guard de limite — refazê-los em código de edição
-- duplicaria toda a lógica de 0002. Em vez disso, SUBSTITUI atomicamente:
--   1. valida que a antiga pode sair (mesmos guards de 0007: sem parcela
--      PAGA, sem parcela em fatura FECHADA/PAGA);
--   2. soft-delete da antiga (trigger cascateia as parcelas e libera limite);
--   3. cria a nova via processar_transacao_completa (limite, faturas,
--      divisão centesimal — tudo reaproveitado e já testado);
--   4. aplica categoria explícita (senão o trigger 0008 autocategoriza).
-- Tudo na MESMA transação: se a criação falhar (ex.: FW429 limite), o
-- soft-delete reverte junto — nunca fica sem a transação original.
-- Padrões: DEFINER + search_path='' + escopo auth.uid() + FW4xx (CLAUDE.md).
-- =====================================================================
create or replace function public.substituir_transacao(
  p_transacao_id    uuid,
  p_descricao       text,
  p_valor_total     bigint,             -- centavos
  p_tipo            text,               -- DESPESA | RECEITA
  p_forma_pagamento text,               -- CREDITO | DEBITO | PIX | DINHEIRO
  p_cartao_id       uuid default null,
  p_data_compra     date default null,
  p_num_parcelas    int  default 1,
  p_categoria_id    uuid default null   -- null = deixa a regra decidir
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_old     public.transacoes_origem%rowtype;
  v_res     jsonb;
  v_new     uuid;
begin
  if v_user_id is null then
    raise exception 'Não autenticado.'
      using errcode = 'FW401', hint = 'Sessão ausente/expirada. Não retente; reautentique.';
  end if;
  if p_transacao_id is null then
    raise exception 'p_transacao_id é obrigatório.'
      using errcode = 'FW400', hint = 'Informe o uuid da transação.';
  end if;

  select * into v_old
  from public.transacoes_origem
  where id = p_transacao_id and user_id = v_user_id and deleted_at is null
  for update;
  if not found then
    raise exception 'Transação % não encontrada para este usuário.', p_transacao_id
      using errcode = 'FW404', hint = 'Confira o id; a transação pode estar excluída.';
  end if;

  -- Guards idênticos aos de 0007: histórico liquidado é imutável.
  if exists (select 1 from public.parcelas
             where transacao_id = v_old.id and user_id = v_user_id
               and status = 'PAGA' and deleted_at is null) then
    raise exception 'Transação % tem parcela PAGA — não pode ser alterada.', p_transacao_id
      using errcode = 'FW409', hint = 'Histórico pago não se edita; lance um estorno (RECEITA).';
  end if;
  if exists (select 1
             from public.parcelas p
             join public.faturas f on f.id = p.fatura_id
             where p.transacao_id = v_old.id and p.user_id = v_user_id
               and p.deleted_at is null and f.deleted_at is null
               and f.status <> 'ABERTA') then
    raise exception 'Transação % tem parcela em fatura FECHADA/PAGA.', p_transacao_id
      using errcode = 'FW409', hint = 'Ciclo fechado não reabre; estorne em vez de editar.';
  end if;

  -- Categoria explícita, se veio, precisa ser do usuário.
  if p_categoria_id is not null and not exists (
      select 1 from public.categorias
      where id = p_categoria_id and user_id = v_user_id and deleted_at is null) then
    raise exception 'Categoria % não encontrada para este usuário.', p_categoria_id
      using errcode = 'FW404', hint = 'Confira o id da categoria.';
  end if;

  -- 1) Soft-delete da antiga (trigger 0001 cascateia parcelas e, com elas,
  --    devolve o limite comprometido antes de recalcular na criação).
  update public.transacoes_origem set deleted_at = now() where id = v_old.id;

  -- 2) Cria a nova reusando o motor completo (valida forma/tipo/parcelas,
  --    limite, faturas, divisão centesimal). Qualquer RAISE aqui reverte o
  --    soft-delete acima (mesma transação).
  v_res := public.processar_transacao_completa(
    p_descricao, p_valor_total, p_tipo, p_forma_pagamento,
    p_cartao_id, p_data_compra, coalesce(p_num_parcelas, 1));
  v_new := (v_res->>'transacao_id')::uuid;

  -- 3) Categoria explícita prevalece sobre a autocategorização por regra.
  if p_categoria_id is not null then
    update public.transacoes_origem
       set categoria_id = p_categoria_id
     where id = v_new and user_id = v_user_id;
  end if;

  return jsonb_build_object(
    'transacao_id', v_new,
    'substituida',  v_old.id,
    'parcelas_criadas', v_res->'parcelas_criadas');
end;
$$;

revoke execute on function public.substituir_transacao(uuid, text, bigint, text, text, uuid, date, int, uuid) from public, anon;
grant  execute on function public.substituir_transacao(uuid, text, bigint, text, text, uuid, date, int, uuid) to authenticated;
