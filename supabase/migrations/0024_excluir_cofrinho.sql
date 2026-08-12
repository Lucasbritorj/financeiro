-- =====================================================================
-- 0024_excluir_cofrinho.sql
-- Exclusão de cofrinho. A 0010 criou cofrinhos com `deleted_at` na tabela
-- mas nunca escreveu a RPC que o preenche: dava para criar, aportar,
-- resgatar e arquivar, nunca excluir.
--
-- ARQUIVAR ≠ EXCLUIR (os dois continuam existindo, de propósito):
--   arquivar_cofrinho -> `arquivado = true`. Meta cumprida, sai da lista
--                        ativa mas continua consultável e reversível.
--   excluir_cofrinho  -> `deleted_at = now()`. Sai de vista.
--
-- POR QUE SOFT-DELETE BASTA, SEM MEXER EM NENHUMA QUERY:
-- as policies de RLS já são
--   cofrinhos_select:    auth.uid() = user_id AND deleted_at IS NULL
--   mov_cofrinho_select: auth.uid() = user_id AND deleted_at IS NULL
-- então preencher deleted_at some da lista e de todo agregado sozinho.
-- `cofrinhos/page.tsx` filtra só `arquivado = false` e continua correto.
--
-- SALDO: espelha excluir_cartao (0006), que recusa cartão com parcela
-- pendente antes de excluir. Aqui, saldo > 0 recusa com FW409 — dinheiro
-- não pode sumir por omissão. `p_resgatar_saldo = true` é o opt-in
-- explícito: registra o RESGATE total como movimentação (o histórico
-- mostra para onde o dinheiro foi) e só então exclui.
--
-- MOVIMENTAÇÕES: cascata de SOFT-delete, o padrão da casa desde a 0001
-- ("cascata de soft delete"). As linhas continuam na tabela, com
-- deleted_at preenchido — recuperáveis por um UPDATE. Nada de DELETE
-- físico, que aliás é impossível: a 0005 revogou o privilégio.
--
-- Aporte e resgate NÃO tocam transacoes_origem (verificado na 0010): o
-- cofrinho é um envelope interno. Excluir um não mexe em caixa nem em
-- nenhum relatório de despesa.
-- =====================================================================

create or replace function public.excluir_cofrinho(
  p_cofrinho_id    uuid,
  p_resgatar_saldo boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_user_id uuid := auth.uid();
  v_c       public.cofrinhos%rowtype;
  v_data    date := (now() at time zone 'America/Sao_Paulo')::date;
  v_movs    int;
  v_resgatado bigint := 0;
begin
  if v_user_id is null then
    raise exception 'Não autenticado.'
      using errcode = 'FW401', hint = 'Sessão ausente/expirada. Não retente; reautentique.';
  end if;
  if p_cofrinho_id is null then
    raise exception 'p_cofrinho_id é obrigatório.'
      using errcode = 'FW400', hint = 'Envie o id do cofrinho.';
  end if;

  -- FOR UPDATE serializa duplo-clique em "Excluir" e corrida com um
  -- aporte simultâneo: se um aporte entrar entre o SELECT e o UPDATE,
  -- ele espera o lock e o saldo lido aqui continua sendo o verdadeiro.
  -- Arquivado PODE ser excluído (é o caso mais comum: cofrinho velho).
  select * into v_c
  from public.cofrinhos
  where id = p_cofrinho_id and user_id = v_user_id and deleted_at is null
  for update;
  if not found then
    raise exception 'Cofrinho % não encontrado para este usuário.', p_cofrinho_id
      using errcode = 'FW404', hint = 'Confira o id; o cofrinho pode já estar excluído.';
  end if;

  if v_c.saldo_atual > 0 and not coalesce(p_resgatar_saldo, false) then
    raise exception 'Cofrinho "%" ainda tem % centavos guardados.', v_c.nome, v_c.saldo_atual
      using errcode = 'FW409',
            hint = 'Resgate o saldo antes de excluir, ou chame de novo com p_resgatar_saldo = true para resgatar tudo e excluir na mesma operação.';
  end if;

  if v_c.saldo_atual > 0 then
    -- Resgate total registrado como movimentação ANTES do soft-delete:
    -- o histórico precisa mostrar que o dinheiro saiu, não sumir junto
    -- com o cofrinho. Não chama resgatar_cofrinho de propósito — aquela
    -- RPC recusa cofrinho arquivado, e arquivado é justamente o caso
    -- mais comum de exclusão.
    v_resgatado := v_c.saldo_atual;
    insert into public.movimentacoes_cofrinho (user_id, cofrinho_id, valor, tipo, data)
    values (v_user_id, v_c.id, v_resgatado, 'RESGATE', v_data);
    update public.cofrinhos set saldo_atual = 0 where id = v_c.id;
  end if;

  update public.cofrinhos
     set deleted_at = now()
   where id = v_c.id;

  update public.movimentacoes_cofrinho
     set deleted_at = now()
   where cofrinho_id = v_c.id and user_id = v_user_id and deleted_at is null;
  get diagnostics v_movs = row_count;

  return jsonb_build_object(
    'cofrinho_id',            v_c.id,
    'nome',                   v_c.nome,
    'saldo_resgatado',        v_resgatado,
    'movimentacoes_ocultadas', v_movs);
end;
$fn$;

comment on function public.excluir_cofrinho(uuid, boolean) is
  'Soft-delete de cofrinho. Recusa com FW409 se houver saldo, salvo p_resgatar_saldo = true (registra RESGATE total antes). Cascata de soft-delete nas movimentações — nenhuma linha é apagada fisicamente.';

revoke execute on function public.excluir_cofrinho(uuid, boolean) from public, anon;
grant  execute on function public.excluir_cofrinho(uuid, boolean) to authenticated;
