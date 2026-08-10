-- =====================================================================
-- 0010_cofrinhos.sql
-- Planejamento leve (modelo §4-D): cofrinhos por horizonte (curto/médio/
-- longo) com aporte/resgate atômicos. Projeção de ritmo/status é cálculo
-- puro do frontend (src/lib/cofrinhos.ts) — o banco guarda fatos, não
-- derivados. Orçamento por envelope reusa categorias.orcamento_mensal (0008).
-- =====================================================================

create table public.cofrinhos (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  nome        text not null,
  icone       text,
  cor         text,
  valor_alvo  bigint not null check (valor_alvo > 0),   -- centavos
  data_alvo   date,
  horizonte   text not null check (horizonte in ('CURTO','MEDIO','LONGO')),
  saldo_atual bigint not null default 0 check (saldo_atual >= 0),
  arquivado   boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);

create table public.movimentacoes_cofrinho (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  cofrinho_id uuid not null references public.cofrinhos (id),
  valor       bigint not null check (valor > 0),        -- centavos
  tipo        text not null check (tipo in ('APORTE','RESGATE')),
  data        date not null default current_date,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);

create index cofrinhos_user_idx on public.cofrinhos (user_id) where deleted_at is null;
create index mov_cofrinho_user_idx on public.movimentacoes_cofrinho (user_id) where deleted_at is null;
create index mov_cofrinho_cofrinho_idx on public.movimentacoes_cofrinho (cofrinho_id) where deleted_at is null;

alter table public.cofrinhos              enable row level security;
alter table public.movimentacoes_cofrinho enable row level security;
create policy cofrinhos_select on public.cofrinhos
  for select using ((select auth.uid()) = user_id and deleted_at is null);
create policy mov_cofrinho_select on public.movimentacoes_cofrinho
  for select using ((select auth.uid()) = user_id and deleted_at is null);

revoke insert, update, delete
  on public.cofrinhos, public.movimentacoes_cofrinho
  from authenticated, anon;
grant select
  on public.cofrinhos, public.movimentacoes_cofrinho
  to authenticated, anon;

create trigger trg_touch_updated_at before update on public.cofrinhos
  for each row execute function public.fn_touch_updated_at();
create trigger trg_touch_updated_at before update on public.movimentacoes_cofrinho
  for each row execute function public.fn_touch_updated_at();

-- ------------------------------ RPCs ------------------------------
create or replace function public.criar_cofrinho(
  p_nome       text,
  p_valor_alvo bigint,
  p_horizonte  text,
  p_data_alvo  date default null,
  p_icone      text default null,
  p_cor        text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_qtd int;
  v_id  uuid;
begin
  if v_user_id is null then
    raise exception 'Não autenticado.'
      using errcode = 'FW401', hint = 'Sessão ausente/expirada. Não retente; reautentique.';
  end if;
  if coalesce(trim(p_nome), '') = '' then
    raise exception 'nome é obrigatório.'
      using errcode = 'FW400', hint = 'Dê um nome ao cofrinho (ex.: Reserva de emergência).';
  end if;
  if p_valor_alvo is null or p_valor_alvo <= 0 then
    raise exception 'valor_alvo deve ser positivo, em centavos. Recebido: %', p_valor_alvo
      using errcode = 'FW400', hint = 'Envie o alvo em centavos (inteiro > 0).';
  end if;
  if p_horizonte not in ('CURTO','MEDIO','LONGO') then
    raise exception 'horizonte inválido: %', p_horizonte
      using errcode = 'FW400', hint = 'Use CURTO, MEDIO ou LONGO.';
  end if;
  if p_data_alvo is not null
     and p_data_alvo <= (now() at time zone 'America/Sao_Paulo')::date then
    raise exception 'data_alvo deve ser futura: %', p_data_alvo
      using errcode = 'FW400', hint = 'Escolha uma data após hoje ou omita.';
  end if;

  select count(*) into v_qtd
  from public.cofrinhos
  where user_id = v_user_id and deleted_at is null and not arquivado;
  if v_qtd >= 30 then
    raise exception 'Teto de 30 cofrinhos ativos atingido.'
      using errcode = 'FW429', hint = 'Arquive um cofrinho antes de criar outro.';
  end if;

  insert into public.cofrinhos (user_id, nome, valor_alvo, horizonte, data_alvo, icone, cor)
  values (v_user_id, trim(p_nome), p_valor_alvo, p_horizonte, p_data_alvo, p_icone, p_cor)
  returning id into v_id;

  return jsonb_build_object('cofrinho_id', v_id);
end;
$$;

-- Aporte/resgate compartilham o esqueleto: lock no cofrinho, movimento,
-- saldo atualizado na MESMA transação (o CHECK saldo >= 0 é o guarda final).
create or replace function public.aportar_cofrinho(
  p_cofrinho_id uuid,
  p_valor       bigint,
  p_data        date default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_c public.cofrinhos%rowtype;
  v_data date := coalesce(p_data, (now() at time zone 'America/Sao_Paulo')::date);
begin
  if v_user_id is null then
    raise exception 'Não autenticado.'
      using errcode = 'FW401', hint = 'Sessão ausente/expirada. Não retente; reautentique.';
  end if;
  if p_valor is null or p_valor <= 0 then
    raise exception 'valor deve ser positivo, em centavos. Recebido: %', p_valor
      using errcode = 'FW400', hint = 'Envie centavos (inteiro > 0).';
  end if;

  select * into v_c
  from public.cofrinhos
  where id = p_cofrinho_id and user_id = v_user_id
    and deleted_at is null and not arquivado
  for update;
  if not found then
    raise exception 'Cofrinho % não encontrado ou arquivado.', p_cofrinho_id
      using errcode = 'FW404', hint = 'Confira o id; desarquive o cofrinho para movimentar.';
  end if;

  insert into public.movimentacoes_cofrinho (user_id, cofrinho_id, valor, tipo, data)
  values (v_user_id, v_c.id, p_valor, 'APORTE', v_data);

  update public.cofrinhos
     set saldo_atual = saldo_atual + p_valor
   where id = v_c.id;

  return jsonb_build_object('cofrinho_id', v_c.id, 'saldo_atual', v_c.saldo_atual + p_valor);
end;
$$;

create or replace function public.resgatar_cofrinho(
  p_cofrinho_id uuid,
  p_valor       bigint,
  p_data        date default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_c public.cofrinhos%rowtype;
  v_data date := coalesce(p_data, (now() at time zone 'America/Sao_Paulo')::date);
begin
  if v_user_id is null then
    raise exception 'Não autenticado.'
      using errcode = 'FW401', hint = 'Sessão ausente/expirada. Não retente; reautentique.';
  end if;
  if p_valor is null or p_valor <= 0 then
    raise exception 'valor deve ser positivo, em centavos. Recebido: %', p_valor
      using errcode = 'FW400', hint = 'Envie centavos (inteiro > 0).';
  end if;

  select * into v_c
  from public.cofrinhos
  where id = p_cofrinho_id and user_id = v_user_id
    and deleted_at is null and not arquivado
  for update;
  if not found then
    raise exception 'Cofrinho % não encontrado ou arquivado.', p_cofrinho_id
      using errcode = 'FW404', hint = 'Confira o id; desarquive o cofrinho para movimentar.';
  end if;
  if p_valor > v_c.saldo_atual then
    raise exception 'Resgate de % maior que o saldo de % (centavos).', p_valor, v_c.saldo_atual
      using errcode = 'FW409', hint = 'Resgate no máximo o saldo atual.';
  end if;

  insert into public.movimentacoes_cofrinho (user_id, cofrinho_id, valor, tipo, data)
  values (v_user_id, v_c.id, p_valor, 'RESGATE', v_data);

  update public.cofrinhos
     set saldo_atual = saldo_atual - p_valor
   where id = v_c.id;

  return jsonb_build_object('cofrinho_id', v_c.id, 'saldo_atual', v_c.saldo_atual - p_valor);
end;
$$;

create or replace function public.arquivar_cofrinho(
  p_cofrinho_id uuid,
  p_arquivado   boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'Não autenticado.'
      using errcode = 'FW401', hint = 'Sessão ausente/expirada. Não retente; reautentique.';
  end if;
  update public.cofrinhos
     set arquivado = coalesce(p_arquivado, true)
   where id = p_cofrinho_id and user_id = v_user_id and deleted_at is null;
  if not found then
    raise exception 'Cofrinho % não encontrado para este usuário.', p_cofrinho_id
      using errcode = 'FW404', hint = 'Confira o id; o cofrinho pode estar excluído.';
  end if;
  return jsonb_build_object('cofrinho_id', p_cofrinho_id, 'arquivado', coalesce(p_arquivado, true));
end;
$$;

-- ------------------- PRIVILÉGIOS -------------------
revoke execute on function public.criar_cofrinho(text, bigint, text, date, text, text) from public, anon;
revoke execute on function public.aportar_cofrinho(uuid, bigint, date)                 from public, anon;
revoke execute on function public.resgatar_cofrinho(uuid, bigint, date)                from public, anon;
revoke execute on function public.arquivar_cofrinho(uuid, boolean)                     from public, anon;
grant  execute on function public.criar_cofrinho(text, bigint, text, date, text, text) to authenticated;
grant  execute on function public.aportar_cofrinho(uuid, bigint, date)                 to authenticated;
grant  execute on function public.resgatar_cofrinho(uuid, bigint, date)                to authenticated;
grant  execute on function public.arquivar_cofrinho(uuid, boolean)                     to authenticated;
