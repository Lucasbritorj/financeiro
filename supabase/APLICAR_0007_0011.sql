-- =====================================================================
-- APLICAR_0007_0011.sql — bundle das migrations da camada de assistente.
-- Cole ESTE arquivo inteiro no SQL Editor do Supabase e clique RUN.
-- Rode UMA vez, em ordem. Pré-requisito: 0001-0006 já aplicadas.
-- Se você já aplicou 0007-0010 antes, rode APENAS 0011 (arquivo
-- supabase/migrations/0011_substituir_transacao.sql).
-- =====================================================================


-- ============================ 0007_editar_transacao.sql ============================
-- =====================================================================
-- 0007_editar_transacao.sql
-- Edição de lançamento (descrição, valor, data). Até aqui o app só
-- criava/excluía — corrigir um typo exigia excluir e relançar.
--
-- Regras:
--   * Parcela PAGA em qualquer número => FW409 (histórico se estorna).
--   * Parcela em fatura FECHADA/PAGA  => FW409 (ciclo liquidado não reabre).
--   * Valor novo redistribui nas parcelas existentes: base = total DIV n,
--     resto na 1ª parcela (mesma regra centesimal de 0002).
--   * Aumento de valor em CREDITO/DESPESA repassa o guard de limite.
--   * Data nova: livre fora do crédito; no crédito só se a competência da
--     1ª parcela não mudar (mudança de ciclo = excluir e relançar — a
--     realocação de faturas tem regras demais para uma edição implícita).
-- Padrões do projeto: DEFINER + search_path='' + escopo auth.uid() em
-- toda query + FW4xx com hint. updated_at é do trigger (0006).
-- =====================================================================
create or replace function public.editar_transacao(
  p_transacao_id uuid,
  p_descricao    text   default null,   -- null = mantém
  p_valor_total  bigint default null,   -- centavos; null = mantém
  p_data_compra  date   default null    -- null = mantém
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id      uuid := auth.uid();
  v_t            public.transacoes_origem%rowtype;
  v_cartao       public.cartoes_credito%rowtype;
  v_valor        bigint;
  v_data         date;
  v_base         bigint;
  v_resto        bigint;
  v_comprometido bigint;
  v_dia_fech     int;
  v_comp_nova    date;
  v_comp_atual   date;
  v_soma         bigint;
  v_atualizadas  int := 0;
begin
  if v_user_id is null then
    raise exception 'Não autenticado.'
      using errcode = 'FW401', hint = 'Sessão ausente/expirada. Não retente; reautentique.';
  end if;
  if p_transacao_id is null then
    raise exception 'p_transacao_id é obrigatório.'
      using errcode = 'FW400', hint = 'Informe o uuid da transação.';
  end if;
  if p_descricao is null and p_valor_total is null and p_data_compra is null then
    raise exception 'Nada a editar.'
      using errcode = 'FW400', hint = 'Informe ao menos um campo (descrição, valor ou data).';
  end if;

  select * into v_t
  from public.transacoes_origem
  where id = p_transacao_id and user_id = v_user_id and deleted_at is null
  for update;
  if not found then
    raise exception 'Transação % não encontrada para este usuário.', p_transacao_id
      using errcode = 'FW404', hint = 'Confira o id; a transação pode estar excluída.';
  end if;

  -- Histórico liquidado é imutável (mesma regra de excluir_transacao).
  if exists (select 1 from public.parcelas
             where transacao_id = v_t.id and user_id = v_user_id
               and status = 'PAGA' and deleted_at is null) then
    raise exception 'Transação % tem parcela PAGA — não pode ser editada.', p_transacao_id
      using errcode = 'FW409', hint = 'Histórico pago não se edita; lance um estorno (RECEITA).';
  end if;
  if exists (select 1
             from public.parcelas p
             join public.faturas f on f.id = p.fatura_id
             where p.transacao_id = v_t.id and p.user_id = v_user_id
               and p.deleted_at is null and f.deleted_at is null
               and f.status <> 'ABERTA') then
    raise exception 'Transação % tem parcela em fatura FECHADA/PAGA.', p_transacao_id
      using errcode = 'FW409', hint = 'Ciclo fechado não reabre; exclua e relance no próximo ciclo, ou estorne.';
  end if;

  v_valor := coalesce(p_valor_total, v_t.valor_total);
  v_data  := coalesce(p_data_compra, v_t.data_compra);

  -- ===== Validações dos campos novos (mesmos limites de 0002) =====
  if p_descricao is not null and coalesce(trim(p_descricao), '') = '' then
    raise exception 'descricao não pode ficar vazia.'
      using errcode = 'FW400', hint = 'Informe uma descrição ou omita o campo.';
  end if;
  if v_valor <= 0 then
    raise exception 'valor_total deve ser positivo, em centavos. Recebido: %', v_valor
      using errcode = 'FW400', hint = 'Envie o valor em centavos (inteiro > 0).';
  end if;
  if v_valor < v_t.num_parcelas then
    raise exception 'valor (%) menor que o número de parcelas (%): haveria parcela de 0.',
      v_valor, v_t.num_parcelas
      using errcode = 'FW400', hint = 'Aumente o valor ou exclua e relance com menos parcelas.';
  end if;
  if v_data > (now() at time zone 'America/Sao_Paulo')::date + 1
     or v_data < date '2000-01-01' then
    raise exception 'data_compra fora do intervalo plausível: %', v_data
      using errcode = 'FW400', hint = 'Use uma data entre 2000-01-01 e amanhã (America/Sao_Paulo).';
  end if;

  -- ===== Guards específicos de CREDITO =====
  if v_t.forma_pagamento = 'CREDITO' then
    select * into v_cartao
    from public.cartoes_credito
    where id = v_t.cartao_id and user_id = v_user_id and deleted_at is null
    for update;  -- serializa com processar_transacao_completa (guard de limite)
    if not found then
      raise exception 'Cartão da transação não está mais ativo.'
        using errcode = 'FW409', hint = 'Cartão excluído: estorne ou exclua a transação.';
    end if;

    -- Mudança de data não pode mudar a competência da 1ª parcela.
    if p_data_compra is not null then
      v_dia_fech := least(
        v_cartao.dia_fechamento,
        extract(day from (date_trunc('month', v_data) + interval '1 month - 1 day'))::int);
      if extract(day from v_data)::int >= v_dia_fech then
        v_comp_nova := (date_trunc('month', v_data) + interval '1 month')::date;
      else
        v_comp_nova := date_trunc('month', v_data)::date;
      end if;
      select min(data_competencia) into v_comp_atual
      from public.parcelas
      where transacao_id = v_t.id and user_id = v_user_id and deleted_at is null;
      if v_comp_nova is distinct from v_comp_atual then
        raise exception 'Nova data move a compra para outra competência (% -> %).',
          to_char(v_comp_atual, 'MM/YYYY'), to_char(v_comp_nova, 'MM/YYYY')
          using errcode = 'FW409',
                hint = 'Realocação de fatura não é edição: exclua a transação e relance com a nova data.';
      end if;
    end if;

    -- Aumento em DESPESA repassa o limite (comprometido SEM esta transação).
    if v_t.tipo = 'DESPESA' and v_valor > v_t.valor_total then
      select coalesce(sum(p.valor), 0) into v_comprometido
      from public.parcelas p
      join public.transacoes_origem t on t.id = p.transacao_id
      where t.cartao_id = v_cartao.id
        and t.user_id = v_user_id
        and t.tipo = 'DESPESA'
        and t.deleted_at is null
        and t.id <> v_t.id
        and p.status = 'PENDENTE'
        and p.deleted_at is null;
      if v_comprometido + v_valor > v_cartao.limite_total then
        raise exception 'Limite de crédito excedido: comprometido % + novo % > limite % (centavos).',
          v_comprometido, v_valor, v_cartao.limite_total
          using errcode = 'FW429',
                hint = 'Pague faturas pendentes ou reduza o valor.';
      end if;
    end if;
  end if;

  -- ===== Aplicação =====
  update public.transacoes_origem
     set descricao   = coalesce(nullif(trim(coalesce(p_descricao, '')), ''), descricao),
         valor_total = v_valor,
         data_compra = v_data
   where id = v_t.id;

  -- Redistribuição centesimal: resto na 1ª parcela (mesma regra de 0002).
  if p_valor_total is not null and p_valor_total <> v_t.valor_total then
    v_base  := v_valor / v_t.num_parcelas;
    v_resto := v_valor - (v_base * v_t.num_parcelas);
    update public.parcelas
       set valor = v_base + case when numero = 1 then v_resto else 0 end
     where transacao_id = v_t.id and user_id = v_user_id and deleted_at is null;
    get diagnostics v_atualizadas = row_count;

    select sum(valor) into v_soma
    from public.parcelas
    where transacao_id = v_t.id and user_id = v_user_id and deleted_at is null;
    if v_soma is distinct from v_valor then
      raise exception 'Invariante centesimal violada: soma % <> total %.', v_soma, v_valor
        using errcode = 'FW500', hint = 'Falha interna; não retente e reporte com a mensagem completa.';
    end if;
  end if;

  -- Fora do crédito a parcela única acompanha a data da compra.
  if p_data_compra is not null and v_t.forma_pagamento <> 'CREDITO' then
    update public.parcelas
       set data_competencia = v_data
     where transacao_id = v_t.id and user_id = v_user_id and deleted_at is null;
  end if;

  return jsonb_build_object(
    'transacao_id',        v_t.id,
    'parcelas_atualizadas', v_atualizadas);
end;
$$;

revoke execute on function public.editar_transacao(uuid, text, bigint, date) from public, anon;
grant  execute on function public.editar_transacao(uuid, text, bigint, date) to authenticated;


-- ============================ 0008_categorias_e_regras.sql ============================
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


-- ============================ 0009_importacao.sql ============================
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


-- ============================ 0010_cofrinhos.sql ============================
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


-- ============================ 0011_substituir_transacao.sql ============================
-- =====================================================================
-- 0011_substituir_transacao.sql
-- Edição COMPLETA de transação: além de descrição/valor/data (0007), permite
-- trocar tipo (DESPESA/RECEITA), forma de pagamento (CREDITO/DEBITO/PIX/
-- DINHEIRO) e nº de parcelas. Mudar esses campos reestrutura parcelas e
-- faturas e repassa o guard de limite — refazê-los em código de edição
-- duplicaria toda a lógica de 0002. Em vez disso, SUBSTITUI atomicamente:
--   1. valida que a antiga pode sair (mesmos guards de 0007: sem parcela
--      PAGA, sem parcela em fatura FECHADA/PAGA);
--   2. soft-delete da antiga (trigger cascateia as parcelas e libera limite);
--   3. cria a nova via processar_transacao_completa (limite, faturas,
--      divisão centesimal — tudo reaproveitado e já testado);
--   4. aplica categoria explícita (senão o trigger 0008 autocategoriza).
-- Tudo na MESMA transação: se a criação falhar (ex.: FW429 limite), o
-- soft-delete reverte junto — nunca fica sem a transação original.
-- Padrões: DEFINER + search_path='' + escopo auth.uid() + FW4xx (CLAUDE.md).
-- =====================================================================
create or replace function public.substituir_transacao(
  p_transacao_id    uuid,
  p_descricao       text,
  p_valor_total     bigint,             -- centavos
  p_tipo            text,               -- DESPESA | RECEITA
  p_forma_pagamento text,               -- CREDITO | DEBITO | PIX | DINHEIRO
  p_cartao_id       uuid default null,
  p_data_compra     date default null,
  p_num_parcelas    int  default 1,
  p_categoria_id    uuid default null   -- null = deixa a regra decidir
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_old     public.transacoes_origem%rowtype;
  v_res     jsonb;
  v_new     uuid;
begin
  if v_user_id is null then
    raise exception 'Não autenticado.'
      using errcode = 'FW401', hint = 'Sessão ausente/expirada. Não retente; reautentique.';
  end if;
  if p_transacao_id is null then
    raise exception 'p_transacao_id é obrigatório.'
      using errcode = 'FW400', hint = 'Informe o uuid da transação.';
  end if;

  select * into v_old
  from public.transacoes_origem
  where id = p_transacao_id and user_id = v_user_id and deleted_at is null
  for update;
  if not found then
    raise exception 'Transação % não encontrada para este usuário.', p_transacao_id
      using errcode = 'FW404', hint = 'Confira o id; a transação pode estar excluída.';
  end if;

  -- Guards idênticos aos de 0007: histórico liquidado é imutável.
  if exists (select 1 from public.parcelas
             where transacao_id = v_old.id and user_id = v_user_id
               and status = 'PAGA' and deleted_at is null) then
    raise exception 'Transação % tem parcela PAGA — não pode ser alterada.', p_transacao_id
      using errcode = 'FW409', hint = 'Histórico pago não se edita; lance um estorno (RECEITA).';
  end if;
  if exists (select 1
             from public.parcelas p
             join public.faturas f on f.id = p.fatura_id
             where p.transacao_id = v_old.id and p.user_id = v_user_id
               and p.deleted_at is null and f.deleted_at is null
               and f.status <> 'ABERTA') then
    raise exception 'Transação % tem parcela em fatura FECHADA/PAGA.', p_transacao_id
      using errcode = 'FW409', hint = 'Ciclo fechado não reabre; estorne em vez de editar.';
  end if;

  -- Categoria explícita, se veio, precisa ser do usuário.
  if p_categoria_id is not null and not exists (
      select 1 from public.categorias
      where id = p_categoria_id and user_id = v_user_id and deleted_at is null) then
    raise exception 'Categoria % não encontrada para este usuário.', p_categoria_id
      using errcode = 'FW404', hint = 'Confira o id da categoria.';
  end if;

  -- 1) Soft-delete da antiga (trigger 0001 cascateia parcelas e, com elas,
  --    devolve o limite comprometido antes de recalcular na criação).
  update public.transacoes_origem set deleted_at = now() where id = v_old.id;

  -- 2) Cria a nova reusando o motor completo (valida forma/tipo/parcelas,
  --    limite, faturas, divisão centesimal). Qualquer RAISE aqui reverte o
  --    soft-delete acima (mesma transação).
  v_res := public.processar_transacao_completa(
    p_descricao, p_valor_total, p_tipo, p_forma_pagamento,
    p_cartao_id, p_data_compra, coalesce(p_num_parcelas, 1));
  v_new := (v_res->>'transacao_id')::uuid;

  -- 3) Categoria explícita prevalece sobre a autocategorização por regra.
  if p_categoria_id is not null then
    update public.transacoes_origem
       set categoria_id = p_categoria_id
     where id = v_new and user_id = v_user_id;
  end if;

  return jsonb_build_object(
    'transacao_id', v_new,
    'substituida',  v_old.id,
    'parcelas_criadas', v_res->'parcelas_criadas');
end;
$$;

revoke execute on function public.substituir_transacao(uuid, text, bigint, text, text, uuid, date, int, uuid) from public, anon;
grant  execute on function public.substituir_transacao(uuid, text, bigint, text, text, uuid, date, int, uuid) to authenticated;

