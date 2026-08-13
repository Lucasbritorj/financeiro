-- =====================================================================
-- 0027_rls_auto_enable_event_trigger.sql
-- Traz para as migrações um objeto que só existia no banco de produção.
--
-- O PROBLEMA
-- A 0022 executa `revoke execute on function public.rls_auto_enable()`, mas
-- nenhuma migração criava essa função. Ela e o event trigger `ensure_rls`
-- foram criados direto no banco, fora do controle de migrações. Consequência:
-- aplicar as migrações num Postgres limpo abortava na 0022 com
-- "function public.rls_auto_enable() does not exist" — o que derrubava a suíte
-- SQL local inteira e derrubaria o job `sql` do CI no dia em que ele rodasse.
--
-- Isso contradizia o CLAUDE.md do projeto, que declara supabase/migrations/
-- como a fonte da verdade do schema. Este arquivo torna a afirmação verdadeira
-- para este objeto.
--
-- PROVENIÊNCIA — nada aqui foi reconstruído de memória
-- O corpo abaixo é transcrição literal de
--   select pg_get_functiondef(oid) from pg_proc where proname='rls_auto_enable'
-- executado em 12/08/2026 contra bqkichuwmugkjumpvrio (Postgres 17.6).
-- Owner do objeto em produção: `postgres` (não `supabase_admin`), que é o que
-- torna esta migração aplicável pelo mesmo caminho das demais. Os outros 6
-- event triggers do banco pertencem a `supabase_admin` e são de fábrica do
-- Supabase — não entram aqui.
--
-- NÃO É REFATORAÇÃO
-- Duas coisas no corpo divergem do padrão do projeto e foram mantidas de
-- propósito: `search_path = pg_catalog` (o projeto usa `''`) e o
-- `EXCEPTION WHEN OTHERS` que engole a falha e só escreve em RAISE LOG — uma
-- proteção que não avisa quando não protegeu. Corrigir drift e mudar
-- comportamento na mesma migração tornaria impossível saber qual dos dois
-- quebrou algo. Endurecimento, se for o caso, é assunto de outra migração.
--
-- EFEITO PRÁTICO: NENHUM sobre as tabelas atuais
-- Verificado em produção: as 11 tabelas de public têm relrowsecurity = true, e
-- as mesmas 11 recebem `enable row level security` explícito nas migrações
-- 0001/0008/0009/0010/0015. Os conjuntos são idênticos — nenhuma tabela
-- dependia do trigger. Ele é rede de segurança para tabela futura que esqueça
-- o enable, e por isso rodar por último (depois de todas as tabelas já
-- criadas) não deixa lacuna nenhuma.
-- =====================================================================

-- ---------------------------------------------------------------- 1. Função
-- Transcrição literal de pg_get_functiondef. Não editar para "adequar ao
-- padrão": divergência daqui em relação a produção é drift de novo.
CREATE OR REPLACE FUNCTION public.rls_auto_enable()
 RETURNS event_trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        EXECUTE format('alter table if exists %s enable row level security', cmd.object_identity);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
$function$;

-- ---------------------------------------------------------------- 2. Event trigger
-- CREATE EVENT TRIGGER não aceita IF NOT EXISTS, e `drop` + `create` abriria
-- uma janela sem proteção num banco onde o objeto já está ativo. Por isso a
-- checagem no catálogo: em produção esta migração é no-op; em banco limpo
-- (suíte local, CI) ela cria.
do $do$
begin
  if not exists (select 1 from pg_catalog.pg_event_trigger where evtname = 'ensure_rls') then
    create event trigger ensure_rls on ddl_command_end
      when tag in ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      execute function public.rls_auto_enable();
    raise notice '0027: event trigger ensure_rls criado.';
  else
    raise notice '0027: event trigger ensure_rls já existia — nada a fazer.';
  end if;
end;
$do$;

-- Mesma revogação que a 0022 aplica. Repetida aqui para que um banco criado do
-- zero termine no mesmo estado de privilégio, independente da ordem de leitura.
revoke execute on function public.rls_auto_enable() from public, anon, authenticated;

comment on function public.rls_auto_enable() is
  'Event trigger ensure_rls: habilita RLS em tabela nova criada em public. Trazido do banco para as migrações em 0027 — antes existia só em produção. Corpo é transcrição de pg_get_functiondef, não reescrita.';
