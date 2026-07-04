-- =====================================================================
-- 00_shim_auth.sql — shim mínimo do ambiente Supabase para Postgres puro.
-- Só para a suite local (tests/sql/run_local.sh); NUNCA aplicar em produção.
-- Replica o que o Supabase provê de fábrica e as migrações assumem:
--   - roles anon/authenticated;
--   - schema auth com users e auth.uid() lendo request.jwt.claims;
--   - default privileges (GRANT ALL a anon/authenticated em objetos novos),
--     que a 0005 então REVOGA — sem isso o REVOKE não teria o que revogar.
-- =====================================================================

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
end $$;

create schema if not exists auth;

create table if not exists auth.users (
  id    uuid primary key,
  email text
);

-- Idêntico em contrato ao auth.uid() do Supabase: sub do JWT da sessão.
create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')::uuid
$$;

grant usage on schema public to anon, authenticated;
grant usage on schema auth   to anon, authenticated;

-- Espelha os default privileges do Supabase para objetos criados a seguir
-- pelas migrações (executadas como superusuário postgres).
alter default privileges in schema public grant all on tables    to anon, authenticated;
alter default privileges in schema public grant all on functions to anon, authenticated;
alter default privileges in schema public grant all on sequences to anon, authenticated;
