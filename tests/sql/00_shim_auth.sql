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

-- created_at é coluna de fábrica do auth.users do Supabase, e quatro asserts
-- (conciliacao_fatura, excluir_cofrinho, importacao_dedup,
-- importacao_revisao_source) ordenam por ela para pegar o usuário da massa.
-- Faltava aqui só porque nenhum dos asserts que o runner antigo alcançava
-- precisava dela.
--
-- Default é clock_timestamp(), não now(): now() congela no início da transação,
-- então dois usuários criados na mesma massa empatariam e o "order by
-- created_at limit 1" escolheria um dos dois de forma indefinida — teste
-- intermitente. Mesmo motivo documentado em fn_touch_updated_at (0022).
create table if not exists auth.users (
  id         uuid primary key,
  email      text,
  created_at timestamptz not null default clock_timestamp()
);

-- Reexecução do shim sobre banco que já tinha a tabela sem a coluna.
alter table auth.users
  add column if not exists created_at timestamptz not null default clock_timestamp();

-- Usuário de fixture. Existe porque os asserts se dividem em dois contratos:
--   * nucleo, assistente, isolamento e importacao_guard criam o próprio
--     usuário inline (ids ...aa, ...bb, ...cf) dentro da transação;
--   * conciliacao_fatura, excluir_cofrinho, importacao_dedup e
--     importacao_revisao_source NÃO criam — leem `app.test_user_id` e, na
--     falta dele, caem em
--     `select id from auth.users order by created_at limit 1`.
--
-- São 4 e 4. A lista dizia 3 e omitia conciliacao_fatura, que entrou depois
-- com o mesmo par de marcas (`app.test_user_id` na linha 77 e o fallback na
-- 85). Conferir a lista a cada assert novo: quem depende do fixture depende
-- deste arquivo, e a dependência só aparece aqui.
-- O segundo grupo nasceu rodando contra o projeto Supabase real, onde sempre
-- há usuário. Contra Postgres limpo a tabela está vazia e eles abortam em
-- "shim de auth não configurado". O cabeçalho de importacao_dedup já mandava
-- rodar "com o shim de auth" — o shim é que nunca cumpriu essa parte.
--
-- Id fora da faixa usada pelos testes (...aa, ...bb, ...cf) para não colidir.
-- Fica commitado (fora de transação de teste) e é sempre o mais antigo, então
-- o "order by created_at limit 1" é determinístico: os usuários que os outros
-- asserts criam nascem depois e desaparecem no rollback.
insert into auth.users (id, email)
values ('00000000-0000-0000-0000-0000000000fe', 'fixture@local.dev')
on conflict (id) do nothing;

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
