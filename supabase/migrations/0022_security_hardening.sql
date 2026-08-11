-- =====================================================================
-- 0022_security_hardening.sql
-- Endurecimento de privilégios. Nenhuma mudança de comportamento do app:
-- só remoção de poder que ninguém usa. Zero DDL de produto.
--
-- CONTEXTO — por que sobrou privilégio depois de 0005 e 0017:
-- O default privilege de `public` neste projeto (herdado do stock Supabase)
-- concede a anon e authenticated `arwdDxtm` em TODA tabela nova:
--   a=INSERT r=SELECT w=UPDATE d=DELETE D=TRUNCATE x=REFERENCES t=TRIGGER m=MAINTAIN
-- A 0005 revogou "DML direto" (insert/update/delete) e a 0017 endureceu mais,
-- mas as duas listaram só os verbos de DML. TRUNCATE, REFERENCES e TRIGGER
-- ficaram — e, pior, o default reaplica os três a cada tabela criada depois
-- (foi o que aconteceu com importacoes/importacao_linhas na 0009).
--
-- POR QUE TRUNCATE É O ITEM SÉRIO:
-- TRUNCATE ignora RLS. Não é DELETE com policy: é uma operação de tabela
-- inteira. Um `authenticated` que conseguisse emitir SQL arbitrário apagaria
-- a base de TODOS os usuários, não só a dele — a RLS que protege o resto do
-- schema não olha para TRUNCATE.
-- Exploitabilidade HOJE: nenhuma rota conhecida. PostgREST emite
-- SELECT/INSERT/UPDATE/DELETE e RPC; não emite TRUNCATE. Ou seja: privilégio
-- latente, não vulnerabilidade ativa. Removido porque o custo é zero e a
-- distância entre "concedido" e "necessário" é total.
-- =====================================================================

-- ---------------------------------------------------------------- 1. Verbos residuais
-- TRUNCATE / REFERENCES / TRIGGER em todas as 11 tabelas + 3 views.
-- MAINTAIN (PG17: VACUUM/ANALYZE/REINDEX/CLUSTER) entra na mesma limpeza:
-- não é vetor de confidencialidade, mas também não tem uso no app.
revoke truncate, references, trigger
  on all tables in schema public
  from anon, authenticated;

do $do$
begin
  -- MAINTAIN só existe a partir do PG17; isolado para a migration não quebrar
  -- se um dia rodar contra instância mais antiga (ex.: shim de teste local).
  execute 'revoke maintain on all tables in schema public from anon, authenticated';
exception when syntax_error or feature_not_supported then
  raise notice '0022: MAINTAIN não suportado nesta versão — ignorado.';
end $do$;

-- ---------------------------------------------------------------- 2. Escrita nas views
-- authenticated tinha INSERT/UPDATE/DELETE em vw_carteira, vw_contas_a_pagar
-- e vw_faturas_consolidadas. Hoje o grant é INERTE: as três são
-- `is_updatable = NO` (têm agregação/junção) e não têm INSTEAD OF trigger,
-- então o Postgres recusa a escrita independente do privilégio — verificado
-- em information_schema.views antes desta migration.
-- Removido mesmo assim: se alguém simplificar uma dessas views no futuro,
-- ela vira auto-updatable e o grant esquecido abre um caminho de escrita que
-- contorna as RPCs SECURITY DEFINER — o único caminho de escrita desenhado.
revoke insert, update, delete
  on public.vw_carteira, public.vw_contas_a_pagar, public.vw_faturas_consolidadas
  from anon, authenticated;

-- ---------------------------------------------------------------- 3. Default privileges
-- Sem isto, a próxima tabela criada em public nasce outra vez com TRUNCATE.
-- Fail-closed de propósito: mexo só nos três verbos sem uso. INSERT/SELECT/
-- UPDATE/DELETE continuam no default porque o padrão do projeto é criar a
-- tabela e então revogar/conceder explicitamente na própria migration —
-- tirá-los daqui faria uma migration futura quebrar com "permission denied"
-- num lugar difícil de diagnosticar.
alter default privileges in schema public
  revoke truncate, references, trigger on tables from anon, authenticated;

do $do$
begin
  execute 'alter default privileges in schema public revoke maintain on tables from anon, authenticated';
exception when syntax_error or feature_not_supported then
  raise notice '0022: MAINTAIN em default privileges não suportado — ignorado.';
end $do$;

-- ---------------------------------------------------------------- 4. search_path de trigger
-- fn_touch_updated_at era a única função em public sem search_path fixo
-- (proconfig = NULL). É SECURITY INVOKER e não tem grant de EXECUTE para
-- ninguém, então o risco prático é baixo — mas `clock_timestamp()` sem
-- qualificação resolve pelo search_path de quem dispara o trigger, que é o
-- padrão CWE-426 e o que o advisor do Supabase aponta.
-- Corpo idêntico ao anterior; só a resolução de nome deixa de ser ambígua.
create or replace function public.fn_touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $fn$
begin
  -- clock_timestamp(), não now(): now() congela no início da transação e
  -- deixaria updated_at indistinguível de created_at em fluxos batch/teste.
  new.updated_at := pg_catalog.clock_timestamp();
  return new;
end;
$fn$;

-- ---------------------------------------------------------------- 5. rls_auto_enable
-- CORREÇÃO DE UM DIAGNÓSTICO ANTERIOR: esta função foi reportada como
-- "executável por anon, verifique hoje". Depois de ler o corpo, o quadro é
-- outro. Ela `RETURNS event_trigger` — o Postgres recusa chamada direta e o
-- PostgREST não expõe funções desse tipo, então não há caminho de invocação.
-- Além disso o que ela faz é PROTETIVO: está ligada ao event trigger
-- `ensure_rls` e habilita RLS automaticamente em tabela nova criada em public.
-- O EXECUTE para anon/public é ruído de catálogo, não vulnerabilidade.
-- Revogado por higiene (event trigger não consulta EXECUTE para disparar,
-- então remover não afeta o funcionamento).
revoke execute on function public.rls_auto_enable() from public, anon, authenticated;

-- ---------------------------------------------------------------- 6. Verificação
-- Roda dentro da própria migration: se algum privilégio perigoso sobreviver,
-- a migration falha em vez de reportar sucesso silencioso.
do $do$
declare
  v_restante int;
  v_detalhe  text;
begin
  select count(*), coalesce(string_agg(distinct grantee || ':' || privilege_type, ', '), '')
    into v_restante, v_detalhe
  from information_schema.role_table_grants
  where table_schema = 'public'
    and grantee in ('anon','authenticated')
    and privilege_type in ('TRUNCATE','REFERENCES','TRIGGER');
  if v_restante > 0 then
    raise exception '0022: sobraram % grants perigosos: %', v_restante, v_detalhe;
  end if;

  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'fn_touch_updated_at'
      and p.proconfig is null
  ) then
    raise exception '0022: fn_touch_updated_at continua sem search_path fixo.';
  end if;

  raise notice '0022: verificação OK — nenhum TRUNCATE/REFERENCES/TRIGGER para anon/authenticated.';
end $do$;
