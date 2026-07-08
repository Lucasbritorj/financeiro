-- =====================================================================
-- 0009_importacao.sql
-- Importação em camadas (modelo §4-C): upload -> STAGING -> revisão ->
-- commit em lote atômico. Nunca importar direto no razão.
--   * Dedupe no staging: mesma data + mesmo valor + descrição igual
--     (normalizada). Duplicada nasce com ignorar = true; o usuário
--     re-marca na revisão se quiser importar mesmo assim.
--   * Categoria sugerida pelas mesmas regras de 0008 (fn_sugerir_categoria).
--   * Idempotência do commit: status REVISAO -> CONFIRMADA dentro da
--     mesma transação; retry após sucesso recebe FW409, nunca duplica.
--   * Pluggy (Nível 2) reusa este staging com origem = 'PLUGGY'.
-- =====================================================================

create table public.importacoes (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  origem     text not null default 'CSV'
             check (origem in ('CSV','OFX','PLUGGY')),
  status     text not null default 'REVISAO'
             check (status in ('REVISAO','CONFIRMADA','DESCARTADA')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table public.importacao_linhas (
  id                 uuid primary key default gen_random_uuid(),
  importacao_id      uuid not null references public.importacoes (id),
  user_id            uuid not null references auth.users (id) on delete cascade,
  data               date not null,
  valor              bigint not null check (valor <> 0),  -- centavos; sinal = tipo
  descricao          text not null,
  categoria_sugerida uuid references public.categorias (id),
  duplicada          boolean not null default false,
  ignorar            boolean not null default false,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  deleted_at         timestamptz
);

create index importacoes_user_idx   on public.importacoes (user_id)             where deleted_at is null;
create index import_linhas_imp_idx  on public.importacao_linhas (importacao_id) where deleted_at is null;
create index import_linhas_user_idx on public.importacao_linhas (user_id)       where deleted_at is null;
-- Dedupe consulta o razão por (data, valor): índice dedicado.
create index transacoes_data_valor_idx
  on public.transacoes_origem (user_id, data_compra, valor_total) where deleted_at is null;

alter table public.importacoes       enable row level security;
alter table public.importacao_linhas enable row level security;
create policy importacoes_select on public.importacoes
  for select using ((select auth.uid()) = user_id and deleted_at is null);
create policy import_linhas_select on public.importacao_linhas
  for select using ((select auth.uid()) = user_id and deleted_at is null);

revoke insert, update, delete
  on public.importacoes, public.importacao_linhas
  from authenticated, anon;
grant select
  on public.importacoes, public.importacao_linhas
  to authenticated, anon;

create trigger trg_touch_updated_at before update on public.importacoes
  for each row execute function public.fn_touch_updated_at();
create trigger trg_touch_updated_at before update on public.importacao_linhas
  for each row execute function public.fn_touch_updated_at();

-- ------------------------------ RPCs ------------------------------
-- Staging: recebe linhas já em centavos (parse de CSV é da UI), marca
-- duplicadas e sugere categoria. p_linhas: [{data, valor, descricao}].
create or replace function public.criar_importacao(
  p_origem text,
  p_linhas jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_id      uuid;
  v_total   int;
  v_dup     int;
begin
  if v_user_id is null then
    raise exception 'Não autenticado.'
      using errcode = 'FW401', hint = 'Sessão ausente/expirada. Não retente; reautentique.';
  end if;
  if p_origem not in ('CSV','OFX','PLUGGY') then
    raise exception 'origem inválida: %', p_origem
      using errcode = 'FW400', hint = 'Use CSV, OFX ou PLUGGY.';
  end if;
  if p_linhas is null or jsonb_typeof(p_linhas) <> 'array' then
    raise exception 'p_linhas deve ser um array JSON.'
      using errcode = 'FW400', hint = 'Envie [{data, valor, descricao}, ...].';
  end if;
  v_total := jsonb_array_length(p_linhas);
  if v_total < 1 or v_total > 1000 then
    raise exception 'Importação com % linhas (mínimo 1, máximo 1000).', v_total
      using errcode = 'FW429', hint = 'Divida o arquivo em lotes de até 1000 linhas.';
  end if;

  insert into public.importacoes (user_id, origem)
  values (v_user_id, p_origem)
  returning id into v_id;

  -- Uma passada set-based: valida, deduplica contra o razão e sugere
  -- categoria. Linha malformada derruba o lote inteiro (staging atômico).
  insert into public.importacao_linhas
    (importacao_id, user_id, data, valor, descricao, categoria_sugerida, duplicada, ignorar)
  select
    v_id, v_user_id, l.data, l.valor, trim(l.descricao),
    case when l.valor < 0
         then public.fn_sugerir_categoria(v_user_id, l.descricao) end,
    d.eh_dup, d.eh_dup
  from jsonb_to_recordset(p_linhas) as l(data date, valor bigint, descricao text)
  cross join lateral (
    select exists (
      select 1 from public.transacoes_origem t
      where t.user_id = v_user_id
        and t.deleted_at is null
        and t.data_compra = l.data
        and t.valor_total = abs(l.valor)
        and lower(trim(t.descricao)) = lower(trim(l.descricao))
    ) as eh_dup
  ) d
  where l.data is not null
    and l.valor is not null and l.valor <> 0
    and coalesce(trim(l.descricao), '') <> ''
    and l.data between date '2000-01-01'
        and (now() at time zone 'America/Sao_Paulo')::date + 1;

  get diagnostics v_total = row_count;
  if v_total <> jsonb_array_length(p_linhas) then
    raise exception 'Lote rejeitado: % de % linhas válidas.', v_total, jsonb_array_length(p_linhas)
      using errcode = 'FW400',
            hint = 'Toda linha precisa de data plausível (2000-01-01..amanhã), valor <> 0 em centavos e descrição.';
  end if;

  select count(*) into v_dup
  from public.importacao_linhas
  where importacao_id = v_id and duplicada;

  return jsonb_build_object(
    'importacao_id', v_id, 'linhas', v_total, 'duplicadas', v_dup);
end;
$$;

-- Revisão: alternar ignorar / trocar categoria de uma linha.
create or replace function public.atualizar_linha_importacao(
  p_linha_id         uuid,
  p_ignorar          boolean default null,  -- null = mantém
  p_categoria_id     uuid default null,
  p_limpar_categoria boolean default false
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
  if p_categoria_id is not null and not exists (
      select 1 from public.categorias
      where id = p_categoria_id and user_id = v_user_id and deleted_at is null) then
    raise exception 'Categoria % não encontrada para este usuário.', p_categoria_id
      using errcode = 'FW404', hint = 'Confira o id da categoria.';
  end if;

  update public.importacao_linhas l
     set ignorar = coalesce(p_ignorar, l.ignorar),
         categoria_sugerida = case when p_limpar_categoria then null
                                   else coalesce(p_categoria_id, l.categoria_sugerida) end
   where l.id = p_linha_id and l.user_id = v_user_id and l.deleted_at is null
     and exists (select 1 from public.importacoes i
                 where i.id = l.importacao_id and i.status = 'REVISAO' and i.deleted_at is null);
  if not found then
    raise exception 'Linha % não encontrada ou importação já finalizada.', p_linha_id
      using errcode = 'FW404', hint = 'Só linhas de importação em REVISAO podem ser alteradas.';
  end if;

  return jsonb_build_object('linha_id', p_linha_id);
end;
$$;

-- Commit atômico: cria transação + parcela única por linha não-ignorada.
-- Importação de extrato = fluxo de caixa (DEBITO); crédito entra pelo
-- lançamento manual/fatura, não pelo extrato da conta.
create or replace function public.confirmar_importacao(p_importacao_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_imp     public.importacoes%rowtype;
  v_criadas int;
begin
  if v_user_id is null then
    raise exception 'Não autenticado.'
      using errcode = 'FW401', hint = 'Sessão ausente/expirada. Não retente; reautentique.';
  end if;

  select * into v_imp
  from public.importacoes
  where id = p_importacao_id and user_id = v_user_id and deleted_at is null
  for update;  -- serializa duplo-clique em "Confirmar"
  if not found then
    raise exception 'Importação % não encontrada para este usuário.', p_importacao_id
      using errcode = 'FW404', hint = 'Confira o id da importação.';
  end if;
  if v_imp.status <> 'REVISAO' then
    raise exception 'Importação % já está %.', p_importacao_id, v_imp.status
      using errcode = 'FW409',
            hint = 'Commit é único por importação — as transações já foram criadas (ou o lote foi descartado). Não retente.';
  end if;

  -- Transações: sinal do valor decide o tipo; categoria explícita da
  -- revisão prevalece (trigger de 0008 só age quando vem nula).
  with alvo as (
    select data, abs(valor) as valor_abs,
           case when valor < 0 then 'DESPESA' else 'RECEITA' end as tipo,
           descricao, categoria_sugerida
    from public.importacao_linhas
    where importacao_id = v_imp.id and user_id = v_user_id
      and deleted_at is null and not ignorar
  ),
  novas as (
    insert into public.transacoes_origem
      (user_id, descricao, valor_total, tipo, forma_pagamento, cartao_id,
       data_compra, num_parcelas, categoria_id)
    select v_user_id, a.descricao, a.valor_abs, a.tipo, 'DEBITO', null,
           a.data, 1, a.categoria_sugerida
    from alvo a
    returning id, valor_total, data_compra
  )
  insert into public.parcelas
    (user_id, transacao_id, fatura_id, numero, valor, data_competencia)
  select v_user_id, n.id, null, 1, n.valor_total, n.data_compra
  from novas n;
  get diagnostics v_criadas = row_count;

  update public.importacoes set status = 'CONFIRMADA' where id = v_imp.id;

  return jsonb_build_object(
    'importacao_id', v_imp.id, 'transacoes_criadas', v_criadas);
end;
$$;

create or replace function public.descartar_importacao(p_importacao_id uuid)
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
  update public.importacoes
     set status = 'DESCARTADA'
   where id = p_importacao_id and user_id = v_user_id
     and status = 'REVISAO' and deleted_at is null;
  if not found then
    raise exception 'Importação % não encontrada em REVISAO.', p_importacao_id
      using errcode = 'FW404', hint = 'Só importações em revisão podem ser descartadas.';
  end if;
  return jsonb_build_object('importacao_id', p_importacao_id);
end;
$$;

-- ------------------- PRIVILÉGIOS -------------------
revoke execute on function public.criar_importacao(text, jsonb)                            from public, anon;
revoke execute on function public.atualizar_linha_importacao(uuid, boolean, uuid, boolean) from public, anon;
revoke execute on function public.confirmar_importacao(uuid)                               from public, anon;
revoke execute on function public.descartar_importacao(uuid)                               from public, anon;
grant  execute on function public.criar_importacao(text, jsonb)                            to authenticated;
grant  execute on function public.atualizar_linha_importacao(uuid, boolean, uuid, boolean) to authenticated;
grant  execute on function public.confirmar_importacao(uuid)                               to authenticated;
grant  execute on function public.descartar_importacao(uuid)                               to authenticated;
