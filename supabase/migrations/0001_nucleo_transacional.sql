-- =====================================================================
-- 0001_nucleo_transacional.sql
-- Convenções: valores monetários em CENTAVOS (bigint), moeda BRL.
-- Competência = date fixado no 1º dia do mês. Soft delete via deleted_at.
-- =====================================================================

-- ------------------------------ TABELAS ------------------------------
create table public.cartoes_credito (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users (id) on delete cascade,
  nome           text not null,
  limite_total   bigint not null check (limite_total > 0),
  dia_fechamento int  not null check (dia_fechamento between 1 and 31),
  dia_vencimento int  not null check (dia_vencimento between 1 and 31),
  created_at     timestamptz not null default now(),
  deleted_at     timestamptz
);

create table public.faturas (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users (id) on delete cascade,
  cartao_id       uuid not null references public.cartoes_credito (id),
  competencia     date not null check (extract(day from competencia) = 1),
  data_vencimento date not null,
  status          text not null default 'ABERTA'
                  check (status in ('ABERTA','FECHADA','PAGA')),
  created_at      timestamptz not null default now(),
  deleted_at      timestamptz,
  constraint faturas_cartao_competencia_uk unique (cartao_id, competencia)
);

create table public.transacoes_origem (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users (id) on delete cascade,
  descricao       text not null,
  valor_total     bigint not null check (valor_total > 0),
  tipo            text not null check (tipo in ('DESPESA','RECEITA')),
  forma_pagamento text not null
                  check (forma_pagamento in ('CREDITO','DEBITO','PIX','DINHEIRO')),
  cartao_id       uuid references public.cartoes_credito (id),
  data_compra     date not null,
  num_parcelas    int  not null default 1 check (num_parcelas >= 1),
  created_at      timestamptz not null default now(),
  deleted_at      timestamptz,
  constraint credito_exige_cartao
    check (forma_pagamento <> 'CREDITO' or cartao_id is not null),
  constraint parcelamento_so_credito
    check (forma_pagamento = 'CREDITO' or num_parcelas = 1)
);

create table public.parcelas (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users (id) on delete cascade,
  transacao_id     uuid not null references public.transacoes_origem (id),
  fatura_id        uuid references public.faturas (id),
  numero           int  not null check (numero >= 1),
  valor            bigint not null check (valor > 0),
  data_competencia date not null,
  status           text not null default 'PENDENTE'
                   check (status in ('PENDENTE','PAGA')),
  created_at       timestamptz not null default now(),
  deleted_at       timestamptz,
  constraint parcelas_transacao_numero_uk unique (transacao_id, numero)
);

-- ------------------------------ ÍNDICES ------------------------------
-- RLS filtra toda query por user_id; FKs precisam de índice para joins.
-- (cartao_id, competencia) já coberto pelo índice da UNIQUE constraint.
create index cartoes_user_idx       on public.cartoes_credito (user_id)    where deleted_at is null;
create index faturas_user_idx       on public.faturas (user_id)            where deleted_at is null;
create index transacoes_user_idx    on public.transacoes_origem (user_id)  where deleted_at is null;
create index transacoes_cartao_idx  on public.transacoes_origem (cartao_id) where deleted_at is null;
create index parcelas_user_idx      on public.parcelas (user_id)           where deleted_at is null;
create index parcelas_transacao_idx on public.parcelas (transacao_id);
create index parcelas_fatura_idx    on public.parcelas (fatura_id)         where deleted_at is null;

-- -------------------------------- RLS --------------------------------
-- (SELECT auth.uid()) força avaliação única por statement (initPlan).
-- Filtro deleted_at IS NULL apenas no SELECT; UPDATE sem o filtro deixa a
-- porta aberta para um futuro RPC de restore (SECURITY DEFINER).
alter table public.cartoes_credito   enable row level security;
alter table public.faturas           enable row level security;
alter table public.transacoes_origem enable row level security;
alter table public.parcelas          enable row level security;

create policy cartoes_select on public.cartoes_credito for select using ((select auth.uid()) = user_id and deleted_at is null);
create policy cartoes_insert on public.cartoes_credito for insert with check ((select auth.uid()) = user_id);
create policy cartoes_update on public.cartoes_credito for update using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy cartoes_delete on public.cartoes_credito for delete using ((select auth.uid()) = user_id);

create policy faturas_select on public.faturas for select using ((select auth.uid()) = user_id and deleted_at is null);
create policy faturas_insert on public.faturas for insert with check ((select auth.uid()) = user_id);
create policy faturas_update on public.faturas for update using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy faturas_delete on public.faturas for delete using ((select auth.uid()) = user_id);

create policy transacoes_select on public.transacoes_origem for select using ((select auth.uid()) = user_id and deleted_at is null);
create policy transacoes_insert on public.transacoes_origem for insert with check ((select auth.uid()) = user_id);
create policy transacoes_update on public.transacoes_origem for update using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy transacoes_delete on public.transacoes_origem for delete using ((select auth.uid()) = user_id);

create policy parcelas_select on public.parcelas for select using ((select auth.uid()) = user_id and deleted_at is null);
create policy parcelas_insert on public.parcelas for insert with check ((select auth.uid()) = user_id);
create policy parcelas_update on public.parcelas for update using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy parcelas_delete on public.parcelas for delete using ((select auth.uid()) = user_id);

-- --------------- SOFT DELETE EM CASCATA (transação -> parcelas) ---------------
-- SECURITY DEFINER: a cascata de restore precisa alcançar parcelas que a
-- policy de SELECT esconde.
create or replace function public.fn_sync_soft_delete_parcelas()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.deleted_at is not null then
    update public.parcelas
       set deleted_at = new.deleted_at
     where transacao_id = new.id
       and deleted_at is null;
  else
    update public.parcelas
       set deleted_at = null
     where transacao_id = new.id
       and deleted_at = old.deleted_at; -- restaura apenas o que esta cascata deletou
  end if;
  return new;
end;
$$;

create trigger trg_transacao_soft_delete
after update of deleted_at on public.transacoes_origem
for each row
when (old.deleted_at is distinct from new.deleted_at)
execute function public.fn_sync_soft_delete_parcelas();
