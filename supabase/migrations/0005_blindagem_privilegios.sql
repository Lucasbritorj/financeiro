-- =====================================================================
-- 0005_blindagem_privilegios.sql
-- Least Privilege: RLS filtra LINHAS, mas não restringe OPERAÇÕES nem
-- colunas — o PostgREST expunha INSERT/UPDATE/DELETE diretos a qualquer
-- usuário autenticado (podendo, ex., editar parcelas.valor e quebrar a
-- invariante SUM(parcelas) = valor_total). A partir daqui, toda escrita
-- passa obrigatoriamente pelas RPCs SECURITY DEFINER.
--
-- DEPENDÊNCIAS VERIFICADAS antes desta migração:
--   1. 0002 e 0003 reescritas como SECURITY DEFINER (re-execute-as ANTES
--      desta migração — como INVOKER elas quebrariam após o REVOKE).
--   2. O formulário de cartão fazia INSERT direto: substituído pela RPC
--      criar_cartao (criada abaixo) no mesmo commit.
--   3. O script de verificação fazia INSERT/UPDATE diretos como
--      authenticated: atualizado para usar RPCs / troca de role.
--   4. O trigger de cascata (fn_sync_soft_delete_parcelas) já é SECURITY
--      DEFINER — não depende de privilégio do chamador.
-- =====================================================================

-- ------------------- 1. REVOGAÇÃO DE DML DIRETO -------------------
-- Leitura continua permitida (RLS filtra por user_id + deleted_at).
revoke insert, update, delete
  on public.cartoes_credito, public.faturas,
     public.transacoes_origem, public.parcelas
  from authenticated, anon;

grant select
  on public.cartoes_credito, public.faturas,
     public.transacoes_origem, public.parcelas
  to authenticated, anon;

-- ------------------- 2. FIM DO DELETE FÍSICO -------------------
-- CLAUDE.md proíbe DELETE físico; sem policy, RLS nega DELETE por padrão
-- (defesa em profundidade além do REVOKE acima).
drop policy if exists cartoes_delete    on public.cartoes_credito;
drop policy if exists faturas_delete    on public.faturas;
drop policy if exists transacoes_delete on public.transacoes_origem;
drop policy if exists parcelas_delete   on public.parcelas;

-- ------------------- 3. RPCs COMO ÚNICA PORTA DE ESCRITA -------------------
-- Cinto-e-suspensório: garante DEFINER mesmo se alguém re-executar uma
-- versão antiga de 0002/0003 depois desta migração.
alter function public.processar_transacao_completa(text, bigint, text, text, uuid, date, int)
  security definer set search_path = '';
alter function public.processar_pagamento_fatura(uuid, timestamptz)
  security definer set search_path = '';

-- Cartão: o INSERT direto do frontend morre com o REVOKE — vira RPC.
-- SECURITY DEFINER + escopo por auth.uid(); validações espelham os CHECKs
-- da tabela para devolver FW400 legível em vez de violação de constraint.
create or replace function public.criar_cartao(
  p_nome           text,
  p_limite_total   bigint,   -- centavos
  p_dia_fechamento int,
  p_dia_vencimento int
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_qtd     int;
  v_id      uuid;
begin
  if v_user_id is null then
    raise exception 'Não autenticado.'
      using errcode = 'FW401', hint = 'Sessão ausente/expirada. Não retente; reautentique.';
  end if;
  if coalesce(trim(p_nome), '') = '' then
    raise exception 'nome é obrigatório.'
      using errcode = 'FW400', hint = 'Informe um nome para o cartão.';
  end if;
  if p_limite_total is null or p_limite_total <= 0 then
    raise exception 'limite_total deve ser positivo, em centavos. Recebido: %', p_limite_total
      using errcode = 'FW400', hint = 'Envie o limite em centavos (inteiro > 0).';
  end if;
  if coalesce(p_dia_fechamento, 0) not between 1 and 31
     or coalesce(p_dia_vencimento, 0) not between 1 and 31 then
    raise exception 'Dias de fechamento/vencimento devem estar entre 1 e 31.'
      using errcode = 'FW400', hint = 'Ajuste os dias para o intervalo [1, 31].';
  end if;

  -- Anti-abuso: teto de cartões ativos por usuário.
  select count(*) into v_qtd
  from public.cartoes_credito
  where user_id = v_user_id and deleted_at is null;
  if v_qtd >= 20 then
    raise exception 'Teto de 20 cartões ativos atingido.'
      using errcode = 'FW429', hint = 'Exclua (soft delete) um cartão antes de criar outro.';
  end if;

  insert into public.cartoes_credito
    (user_id, nome, limite_total, dia_fechamento, dia_vencimento)
  values
    (v_user_id, trim(p_nome), p_limite_total, p_dia_fechamento, p_dia_vencimento)
  returning id into v_id;

  return jsonb_build_object('cartao_id', v_id);
end;
$$;

-- Execução das RPCs: só authenticated (PostgREST expõe funções a anon e
-- PUBLIC por padrão; as funções já barram auth.uid() nulo, mas menos
-- superfície é menos superfície).
revoke execute on function public.processar_transacao_completa(text, bigint, text, text, uuid, date, int) from public, anon;
revoke execute on function public.processar_pagamento_fatura(uuid, timestamptz) from public, anon;
revoke execute on function public.criar_cartao(text, bigint, int, int) from public, anon;
grant execute on function public.processar_transacao_completa(text, bigint, text, text, uuid, date, int) to authenticated;
grant execute on function public.processar_pagamento_fatura(uuid, timestamptz) to authenticated;
grant execute on function public.criar_cartao(text, bigint, int, int) to authenticated;

-- Função de trigger não é chamável por clientes.
revoke execute on function public.fn_sync_soft_delete_parcelas() from public, anon, authenticated;

-- ------------------- 4. CAMADA SEMÂNTICA: ESTORNOS -------------------
-- Fonte única de verdade para o total da fatura: RECEITA (estorno) ABATE,
-- DESPESA soma. Parcelas guardam valor absoluto; o sinal vive aqui.
-- security_invoker = true é OBRIGATÓRIO: view padrão do Postgres roda com
-- privilégio do DONO (bypassa RLS) e vazaria faturas de todos os usuários.
create or replace view public.vw_faturas_consolidadas
with (security_invoker = true)
as
select
  f.id,
  f.user_id,
  f.cartao_id,
  f.competencia,
  extract(year  from f.competencia)::int as ano_referencia,
  extract(month from f.competencia)::int as mes_referencia,
  f.status,
  f.data_vencimento,
  -- COALESCE: fatura sem parcelas ativas fecha em 0, não NULL.
  coalesce(sum(
    case when t.tipo = 'RECEITA' then -p.valor else p.valor end
  ), 0)::bigint as valor_total_fatura
from public.faturas f
left join public.parcelas p
  on p.fatura_id = f.id
 and p.deleted_at is null
left join public.transacoes_origem t
  on t.id = p.transacao_id
where f.deleted_at is null
group by f.id;  -- f.id é PK: demais colunas de f são dependência funcional

revoke all on public.vw_faturas_consolidadas from public, anon;
grant select on public.vw_faturas_consolidadas to authenticated;
