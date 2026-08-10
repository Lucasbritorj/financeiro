-- =====================================================================
-- 0012_carteira_caixa.sql
-- Regime de CAIXA (carteira), complementar ao regime de COMPETÊNCIA já
-- existente. Resolve a confusão do cartão de crédito:
--
--   * Compra no crédito é DESPESA na competência (aparece em "onde gasto"),
--     e vira parcelas em faturas futuras. Ela NÃO sai do caixa na hora.
--   * Pagar a fatura é a saída de caixa que quita o cartão — NÃO é uma nova
--     despesa (contá-la de novo duplicaria a compra parcelada). Por isso o
--     app nunca cria transação ao pagar (0003 só marca PAGA); a carteira
--     apenas subtrai o total das faturas pagas.
--
--   Carteira (saldo de caixa) = receitas
--                             − despesas à vista (DEBITO/PIX/DINHEIRO)
--                             − faturas pagas (total consolidado).
--   Compras no crédito entram no caixa só quando a fatura é paga => sem
--   duplicata entre "a compra parcelada" e "o pagamento da fatura".
--
-- security_invoker = true (obrigatório): a view roda com a RLS do usuário,
-- então cada um vê só o próprio caixa (senão vazaria entre usuários).
-- Sem FROM: os agregados são subqueries escalares filtradas pela RLS das
-- tabelas-base; retorna sempre uma linha (zeros quando não há dados).
-- =====================================================================
create or replace view public.vw_carteira
with (security_invoker = true)
as
select
  coalesce((
    select sum(t.valor_total)
    from public.transacoes_origem t
    where t.tipo = 'RECEITA' and t.deleted_at is null
  ), 0)::bigint as entradas,
  coalesce((
    select sum(t.valor_total)
    from public.transacoes_origem t
    where t.tipo = 'DESPESA'
      and t.forma_pagamento in ('DEBITO', 'PIX', 'DINHEIRO')
      and t.deleted_at is null
  ), 0)::bigint as saidas_avista,
  coalesce((
    select sum(v.valor_total_fatura)
    from public.vw_faturas_consolidadas v
    where v.status = 'PAGA'
  ), 0)::bigint as faturas_pagas,
  (
    coalesce((
      select sum(t.valor_total)
      from public.transacoes_origem t
      where t.tipo = 'RECEITA' and t.deleted_at is null
    ), 0)
    - coalesce((
      select sum(t.valor_total)
      from public.transacoes_origem t
      where t.tipo = 'DESPESA'
        and t.forma_pagamento in ('DEBITO', 'PIX', 'DINHEIRO')
        and t.deleted_at is null
    ), 0)
    - coalesce((
      select sum(v.valor_total_fatura)
      from public.vw_faturas_consolidadas v
      where v.status = 'PAGA'
    ), 0)
  )::bigint as saldo_caixa;

revoke all on public.vw_carteira from public, anon;
grant select on public.vw_carteira to authenticated;
