-- =====================================================================
-- 0008_categorias_e_regras.sql
-- Camada de assistente, parte 1: categorias (com hierarquia e orçamento
-- de envelope opcionais) + regras de categorização determinísticas.
--
-- Arquitetura da categorização (modelo_final_financeiro.md §4-B):
--   regras primeiro, LLM só na cauda não-resolvida (fora do banco).
--   O match roda em trigger BEFORE INSERT quando categoria_id vem nulo —
--   vale para lançamento manual (RPC 0002) e importação (0009) sem mudar
--   a assinatura de processar_transacao_completa.
-- Convenções: centavos bigint, soft delete, RLS por user_id, escrita só
-- por RPC DEFINER + search_path='', erros FW4xx + hint (CLAUDE.md).
-- =====================================================================

-- ------------------------------ TABELAS ------------------------------
create table public.categorias (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users (id) on delete cascade,
  nome             text not null,
  cor              text,             -- hex de token da paleta Ateliê
  icone            text,             -- nome lucide; emoji só como fallback
  tipo             text not null default 'DESPESA'
                   check (tipo in ('DESPESA','RECEITA')),
  categoria_pai    uuid references public.categorias (id),
  orcamento_mensal bigint check (orcamento_mensal is null or orcamento_mensal > 0),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  deleted_at       timestamptz
);

create table public.regras_categorizacao (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  padrao       text not null,     -- substring case-insensitive sobre a descrição
  categoria_id uuid not null references public.categorias (id),
  prioridade   int  not null default 100,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz
);

alter table public.transacoes_origem
  add column categoria_id uuid references public.categorias (id);

create index categorias_user_idx  on public.categorias (user_id)            where deleted_at is null;
create index regras_user_idx      on public.regras_categorizacao (user_id)  where deleted_at is null;
create index transacoes_categoria_idx on public.transacoes_origem (categoria_id) where deleted_at is null;
-- Nome único por usuário entre categorias ativas (case-insensitive).
create unique index categorias_user_nome_uk
  on public.categorias (user_id, lower(nome)) where deleted_at is null;

-- ------------------------------ RLS + PRIVILÉGIOS ------------------------------
-- Mesmo regime de 0005: leitura via RLS, escrita só por RPC DEFINER.
alter table public.categorias           enable row level security;
alter table public.regras_categorizacao enable row level security;

create policy categorias_select on public.categorias
  for select using ((select auth.uid()) = user_id and deleted_at is null);
create policy regras_select on public.regras_categorizacao
  for select using ((select auth.uid()) = user_id and deleted_at is null);

revoke insert, update, delete
  on public.categorias, public.regras_categorizacao
  from authenticated, anon;
grant select
  on public.categorias, public.regras_categorizacao
  to authenticated, anon;

-- updated_at pelo trigger genérico de 0006.
create trigger trg_touch_updated_at before update on public.categorias
  for each row execute function public.fn_touch_updated_at();
create trigger trg_touch_updated_at before update on public.regras_categorizacao
  for each row execute function public.fn_touch_updated_at();

-- ------------------- MATCH DE REGRAS (fonte única) -------------------
-- Substring case-insensitive, prioridade menor vence, desempate pela
-- regra mais antiga. Substring (não regex): input do usuário nunca é
-- interpretado como padrão executável — sem regex inválida quebrando
-- INSERT, sem ReDoS.
create or replace function public.fn_sugerir_categoria(
  p_user_id   uuid,
  p_descricao text
)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select r.categoria_id
  from public.regras_categorizacao r
  join public.categorias c
    on c.id = r.categoria_id and c.deleted_at is null
  where r.user_id = p_user_id
    and r.deleted_at is null
    and position(lower(r.padrao) in lower(p_descricao)) > 0
  order by r.prioridade, r.created_at
  limit 1;
$$;
revoke execute on function public.fn_sugerir_categoria(uuid, text) from public, anon, authenticated;

-- Trigger: categoriza no INSERT quando o chamador não escolheu categoria.
create or replace function public.fn_autocategorizar_transacao()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.categoria_id is null then
    new.categoria_id := public.fn_sugerir_categoria(new.user_id, new.descricao);
  end if;
  return new;
end;
$$;
revoke execute on function public.fn_autocategorizar_transacao() from public, anon, authenticated;

create trigger trg_autocategorizar
before insert on public.transacoes_origem
for each row execute function public.fn_autocategorizar_transacao();

-- ------------------------------ RPCs ------------------------------
create or replace function public.criar_categoria(
  p_nome             text,
  p_cor              text default null,
  p_icone            text default null,
  p_tipo             text default 'DESPESA',
  p_categoria_pai    uuid default null,
  p_orcamento_mensal bigint default null
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
      using errcode = 'FW400', hint = 'Informe um nome para a categoria.';
  end if;
  if p_tipo not in ('DESPESA','RECEITA') then
    raise exception 'tipo inválido: %', p_tipo
      using errcode = 'FW400', hint = 'Use DESPESA ou RECEITA.';
  end if;
  if p_orcamento_mensal is not null and p_orcamento_mensal <= 0 then
    raise exception 'orcamento_mensal deve ser positivo em centavos ou nulo.'
      using errcode = 'FW400', hint = 'Envie centavos (inteiro > 0) ou omita.';
  end if;
  if p_categoria_pai is not null and not exists (
      select 1 from public.categorias
      where id = p_categoria_pai and user_id = v_user_id and deleted_at is null) then
    raise exception 'categoria_pai % não encontrada para este usuário.', p_categoria_pai
      using errcode = 'FW404', hint = 'Confira o id da categoria-mãe.';
  end if;

  select count(*) into v_qtd
  from public.categorias where user_id = v_user_id and deleted_at is null;
  if v_qtd >= 60 then
    raise exception 'Teto de 60 categorias ativas atingido.'
      using errcode = 'FW429', hint = 'Exclua uma categoria antes de criar outra.';
  end if;

  insert into public.categorias
    (user_id, nome, cor, icone, tipo, categoria_pai, orcamento_mensal)
  values
    (v_user_id, trim(p_nome), p_cor, p_icone, p_tipo, p_categoria_pai, p_orcamento_mensal)
  returning id into v_id;

  return jsonb_build_object('categoria_id', v_id);
exception
  when unique_violation then
    raise exception 'Já existe categoria ativa com o nome "%".', trim(p_nome)
      using errcode = 'FW409', hint = 'Use outro nome ou edite a existente.';
end;
$$;

create or replace function public.editar_categoria(
  p_categoria_id     uuid,
  p_nome             text default null,
  p_cor              text default null,
  p_icone            text default null,
  p_orcamento_mensal bigint default null,
  p_limpar_orcamento boolean default false  -- null em p_orcamento = "mantém"
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
  if p_orcamento_mensal is not null and p_orcamento_mensal <= 0 then
    raise exception 'orcamento_mensal deve ser positivo em centavos.'
      using errcode = 'FW400', hint = 'Envie centavos (inteiro > 0), ou p_limpar_orcamento = true.';
  end if;

  update public.categorias
     set nome             = coalesce(nullif(trim(coalesce(p_nome, '')), ''), nome),
         cor              = coalesce(p_cor, cor),
         icone            = coalesce(p_icone, icone),
         orcamento_mensal = case when p_limpar_orcamento then null
                                 else coalesce(p_orcamento_mensal, orcamento_mensal) end
   where id = p_categoria_id and user_id = v_user_id and deleted_at is null;
  if not found then
    raise exception 'Categoria % não encontrada para este usuário.', p_categoria_id
      using errcode = 'FW404', hint = 'Confira o id; a categoria pode estar excluída.';
  end if;

  return jsonb_build_object('categoria_id', p_categoria_id);
exception
  when unique_violation then
    raise exception 'Já existe categoria ativa com esse nome.'
      using errcode = 'FW409', hint = 'Use outro nome.';
end;
$$;

-- Soft delete. Transações mantêm o categoria_id (histórico); as regras
-- que apontavam para ela caem junto (senão continuariam classificando
-- para uma categoria invisível).
create or replace function public.excluir_categoria(p_categoria_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_regras int;
begin
  if v_user_id is null then
    raise exception 'Não autenticado.'
      using errcode = 'FW401', hint = 'Sessão ausente/expirada. Não retente; reautentique.';
  end if;

  update public.categorias
     set deleted_at = now()
   where id = p_categoria_id and user_id = v_user_id and deleted_at is null;
  if not found then
    raise exception 'Categoria % não encontrada para este usuário.', p_categoria_id
      using errcode = 'FW404', hint = 'Confira o id; a categoria pode já estar excluída.';
  end if;

  update public.regras_categorizacao
     set deleted_at = now()
   where categoria_id = p_categoria_id and user_id = v_user_id and deleted_at is null;
  get diagnostics v_regras = row_count;

  return jsonb_build_object('categoria_id', p_categoria_id, 'regras_afetadas', v_regras);
end;
$$;

create or replace function public.criar_regra_categorizacao(
  p_padrao       text,
  p_categoria_id uuid,
  p_prioridade   int default 100
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
  if coalesce(trim(p_padrao), '') = '' or length(trim(p_padrao)) < 2 then
    raise exception 'padrao deve ter ao menos 2 caracteres.'
      using errcode = 'FW400', hint = 'Padrões de 1 caractere casariam com quase tudo.';
  end if;
  if not exists (select 1 from public.categorias
                 where id = p_categoria_id and user_id = v_user_id and deleted_at is null) then
    raise exception 'Categoria % não encontrada para este usuário.', p_categoria_id
      using errcode = 'FW404', hint = 'Confira o id da categoria.';
  end if;

  select count(*) into v_qtd
  from public.regras_categorizacao where user_id = v_user_id and deleted_at is null;
  if v_qtd >= 200 then
    raise exception 'Teto de 200 regras ativas atingido.'
      using errcode = 'FW429', hint = 'Exclua regras antes de criar outra.';
  end if;

  insert into public.regras_categorizacao (user_id, padrao, categoria_id, prioridade)
  values (v_user_id, trim(p_padrao), p_categoria_id, coalesce(p_prioridade, 100))
  returning id into v_id;

  return jsonb_build_object('regra_id', v_id);
end;
$$;

create or replace function public.excluir_regra_categorizacao(p_regra_id uuid)
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
  update public.regras_categorizacao
     set deleted_at = now()
   where id = p_regra_id and user_id = v_user_id and deleted_at is null;
  if not found then
    raise exception 'Regra % não encontrada para este usuário.', p_regra_id
      using errcode = 'FW404', hint = 'Confira o id; a regra pode já estar excluída.';
  end if;
  return jsonb_build_object('regra_id', p_regra_id);
end;
$$;

-- Recategorização manual — opcionalmente vira regra ("sempre classificar
-- IFOOD como Delivery?"), o cache que aprende sem ML.
create or replace function public.definir_categoria_transacao(
  p_transacao_id uuid,
  p_categoria_id uuid,          -- null = remover categoria
  p_criar_regra  boolean default false,
  p_padrao       text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_regra uuid;
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

  update public.transacoes_origem
     set categoria_id = p_categoria_id
   where id = p_transacao_id and user_id = v_user_id and deleted_at is null;
  if not found then
    raise exception 'Transação % não encontrada para este usuário.', p_transacao_id
      using errcode = 'FW404', hint = 'Confira o id da transação.';
  end if;

  if p_criar_regra then
    if p_categoria_id is null then
      raise exception 'Criar regra exige uma categoria.'
        using errcode = 'FW400', hint = 'Informe p_categoria_id junto de p_criar_regra.';
    end if;
    select (public.criar_regra_categorizacao(p_padrao, p_categoria_id) ->> 'regra_id')::uuid
      into v_regra;
  end if;

  return jsonb_build_object('transacao_id', p_transacao_id, 'regra_id', v_regra);
end;
$$;

-- Seed idempotente: só cria quando o usuário não tem NENHUMA categoria
-- ativa (chamado pelo app no primeiro acesso; re-chamar é no-op).
create or replace function public.seed_categorias_padrao()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_criadas int := 0;
begin
  if v_user_id is null then
    raise exception 'Não autenticado.'
      using errcode = 'FW401', hint = 'Sessão ausente/expirada. Não retente; reautentique.';
  end if;
  if exists (select 1 from public.categorias
             where user_id = v_user_id and deleted_at is null) then
    return jsonb_build_object('categorias_criadas', 0);
  end if;

  -- Cores = paleta do mockup Ateliê (docs/mockup_dashboard.html).
  insert into public.categorias (user_id, nome, cor, icone, tipo)
  values
    (v_user_id, 'Moradia',        '#D9A24E', 'home',            'DESPESA'),
    (v_user_id, 'Mercado',        '#7CB49A', 'shopping-cart',   'DESPESA'),
    (v_user_id, 'Delivery',       '#D6674E', 'utensils',        'DESPESA'),
    (v_user_id, 'Transporte',     '#C98A5B', 'bus',             'DESPESA'),
    (v_user_id, 'Assinaturas',    '#A67C8B', 'repeat',          'DESPESA'),
    (v_user_id, 'Lazer',          '#8B9BB0', 'gamepad-2',       'DESPESA'),
    (v_user_id, 'Saúde',          '#B0A15B', 'heart-pulse',     'DESPESA'),
    (v_user_id, 'Outros',         '#A69C8D', 'circle-ellipsis', 'DESPESA'),
    (v_user_id, 'Salário',        '#7CB49A', 'banknote',        'RECEITA'),
    (v_user_id, 'Outras receitas','#D9A24E', 'coins',           'RECEITA');
  get diagnostics v_criadas = row_count;

  -- Regras de comerciante que resolvem a maior parte de graça.
  insert into public.regras_categorizacao (user_id, padrao, categoria_id, prioridade)
  select v_user_id, r.padrao, c.id, r.prioridade
  from (values
    ('IFOOD',  'Delivery',    10),
    ('RAPPI',  'Delivery',    10),
    ('UBER',   'Transporte',  20),
    ('99APP',  'Transporte',  20),
    ('POSTO',  'Transporte',  30),
    ('MERCADO','Mercado',     40),
    ('SUPERM', 'Mercado',     40),
    ('FARMAC', 'Saúde',       40),
    ('DROGARIA','Saúde',      40),
    ('NETFLIX','Assinaturas', 40),
    ('SPOTIFY','Assinaturas', 40),
    ('ALUGUEL','Moradia',     40),
    ('CONDOMIN','Moradia',    40)
  ) as r(padrao, nome_categoria, prioridade)
  join public.categorias c
    on c.user_id = v_user_id and c.nome = r.nome_categoria and c.deleted_at is null;

  return jsonb_build_object('categorias_criadas', v_criadas);
end;
$$;

-- ------------------- PRIVILÉGIOS DAS RPCs -------------------
revoke execute on function public.criar_categoria(text, text, text, text, uuid, bigint)          from public, anon;
revoke execute on function public.editar_categoria(uuid, text, text, text, bigint, boolean)      from public, anon;
revoke execute on function public.excluir_categoria(uuid)                                        from public, anon;
revoke execute on function public.criar_regra_categorizacao(text, uuid, int)                     from public, anon;
revoke execute on function public.excluir_regra_categorizacao(uuid)                              from public, anon;
revoke execute on function public.definir_categoria_transacao(uuid, uuid, boolean, text)         from public, anon;
revoke execute on function public.seed_categorias_padrao()                                       from public, anon;
grant  execute on function public.criar_categoria(text, text, text, text, uuid, bigint)          to authenticated;
grant  execute on function public.editar_categoria(uuid, text, text, text, bigint, boolean)      to authenticated;
grant  execute on function public.excluir_categoria(uuid)                                        to authenticated;
grant  execute on function public.criar_regra_categorizacao(text, uuid, int)                     to authenticated;
grant  execute on function public.excluir_regra_categorizacao(uuid)                              to authenticated;
grant  execute on function public.definir_categoria_transacao(uuid, uuid, boolean, text)         to authenticated;
grant  execute on function public.seed_categorias_padrao()                                       to authenticated;
