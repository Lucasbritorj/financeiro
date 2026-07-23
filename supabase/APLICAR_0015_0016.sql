-- APLICAR_0015_0016.sql — bundle para o SQL Editor do Supabase (projetos que já aplicaram até 0014).
-- Conteúdo: 0015_recorrencias.sql + 0016_importacao_formatos.sql, na ordem.

-- =====================================================================
-- 0015_recorrencias.sql
-- Despesas/receitas recorrentes ("aluguel todo dia 5", "salário dia 1"):
-- o banco guarda a REGRA (valor, dia do mês, forma); a materialização vira
-- transação comum via processar_transacao_completa (0002/0011), herdando
-- parcela única, insights, análise e autocategorização (0008).
--
-- Decisões:
--  * Só formas à vista (DEBITO/PIX/DINHEIRO). Crédito recorrente é
--    assinatura — já aparece na fatura do cartão; boleto recorrente já tem
--    duplicar_boleto (0014). dia_do_mes <= 28 evita aritmética de fevereiro.
--  * SEM pg_cron: aplicar_recorrencias() roda com a sessão do usuário
--    (auth.uid()) e é disparada ao abrir o dashboard. O laço materializa
--    ocorrências ATRASADAS (proxima_data <= hoje), então dias sem abrir o
--    app não perdem lançamento — só chegam mais tarde. Cron exigiria
--    materializar sem sessão (auth.uid() nulo) e reimplementar o motor de
--    escrita fora das RPCs auditadas; custo/risco sem ganho real aqui.
-- =====================================================================

create table public.recorrencias (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users (id) on delete cascade,
  descricao       text not null,
  valor           bigint not null check (valor > 0),          -- centavos
  tipo            text not null check (tipo in ('DESPESA','RECEITA')),
  forma_pagamento text not null check (forma_pagamento in ('DEBITO','PIX','DINHEIRO')),
  categoria_id    uuid references public.categorias (id),
  dia_do_mes      int  not null check (dia_do_mes between 1 and 28),
  proxima_data    date not null,
  ativa           boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz
);

create index recorrencias_user_idx on public.recorrencias (user_id) where deleted_at is null;

alter table public.recorrencias enable row level security;
create policy recorrencias_select on public.recorrencias
  for select using ((select auth.uid()) = user_id and deleted_at is null);

revoke insert, update, delete on public.recorrencias from authenticated, anon;
grant select on public.recorrencias to authenticated, anon;

create trigger trg_touch_updated_at before update on public.recorrencias
  for each row execute function public.fn_touch_updated_at();

-- Próxima ocorrência do dia N a partir de (inclusive) uma data-base.
create or replace function public.fn_proxima_ocorrencia(p_base date, p_dia int)
returns date
language sql
immutable
set search_path = ''
as $$
  select case
    when extract(day from p_base)::int <= p_dia
      then make_date(extract(year from p_base)::int, extract(month from p_base)::int, p_dia)
    else (date_trunc('month', p_base) + interval '1 month')::date + (p_dia - 1)
  end;
$$;
revoke execute on function public.fn_proxima_ocorrencia(date, int) from public, anon, authenticated;

-- ------------------------------ RPCs ------------------------------
create or replace function public.criar_recorrencia(
  p_descricao       text,
  p_valor           bigint,
  p_tipo            text,
  p_forma_pagamento text,
  p_dia_do_mes      int,
  p_categoria_id    uuid default null,
  p_iniciar_em      date default null   -- default: próxima ocorrência a partir de hoje
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_hoje    date := (now() at time zone 'America/Sao_Paulo')::date;
  v_id      uuid;
  v_proxima date;
begin
  if v_user_id is null then
    raise exception 'Não autenticado.'
      using errcode = 'FW401', hint = 'Sessão ausente/expirada. Não retente; reautentique.';
  end if;
  if coalesce(trim(p_descricao), '') = '' then
    raise exception 'Descrição obrigatória.' using errcode = 'FW400', hint = 'Informe a descrição.';
  end if;
  if p_valor is null or p_valor <= 0 then
    raise exception 'Valor deve ser positivo em centavos.' using errcode = 'FW400', hint = 'Envie centavos (inteiro > 0).';
  end if;
  if p_tipo not in ('DESPESA','RECEITA') then
    raise exception 'Tipo inválido: %', p_tipo using errcode = 'FW400', hint = 'Use DESPESA ou RECEITA.';
  end if;
  if p_forma_pagamento not in ('DEBITO','PIX','DINHEIRO') then
    raise exception 'Forma inválida para recorrência: %', p_forma_pagamento
      using errcode = 'FW400',
            hint = 'Recorrência é à vista (DEBITO/PIX/DINHEIRO). Assinatura no crédito já vem na fatura; boleto recorrente usa duplicar_boleto.';
  end if;
  if p_dia_do_mes is null or p_dia_do_mes not between 1 and 28 then
    raise exception 'dia_do_mes deve estar entre 1 e 28.' using errcode = 'FW400',
      hint = 'Dias 29-31 não existem em todo mês; escolha até 28.';
  end if;
  if p_categoria_id is not null and not exists (
    select 1 from public.categorias
     where id = p_categoria_id and user_id = v_user_id and deleted_at is null and tipo = p_tipo
  ) then
    raise exception 'Categoria % inexistente ou de tipo incompatível.', p_categoria_id
      using errcode = 'FW404', hint = 'A categoria precisa ser sua e do mesmo tipo da recorrência.';
  end if;

  v_proxima := public.fn_proxima_ocorrencia(coalesce(p_iniciar_em, v_hoje), p_dia_do_mes);

  insert into public.recorrencias
    (user_id, descricao, valor, tipo, forma_pagamento, categoria_id, dia_do_mes, proxima_data)
  values
    (v_user_id, trim(p_descricao), p_valor, p_tipo, p_forma_pagamento, p_categoria_id, p_dia_do_mes, v_proxima)
  returning id into v_id;

  return jsonb_build_object('recorrencia_id', v_id, 'proxima_data', v_proxima);
end;
$$;

create or replace function public.alternar_recorrencia(p_recorrencia_id uuid, p_ativa boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_hoje    date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  if v_user_id is null then
    raise exception 'Não autenticado.'
      using errcode = 'FW401', hint = 'Sessão ausente/expirada. Não retente; reautentique.';
  end if;

  -- Reativar realinha proxima_data para o futuro: o período pausado não é
  -- lançado retroativamente (pausa significa "não lance").
  update public.recorrencias
     set ativa = p_ativa,
         proxima_data = case when p_ativa then public.fn_proxima_ocorrencia(v_hoje, dia_do_mes)
                             else proxima_data end
   where id = p_recorrencia_id and user_id = v_user_id and deleted_at is null;
  if not found then
    raise exception 'Recorrência % não encontrada.', p_recorrencia_id
      using errcode = 'FW404', hint = 'Confira o id; pode ter sido excluída.';
  end if;
  return jsonb_build_object('recorrencia_id', p_recorrencia_id, 'ativa', p_ativa);
end;
$$;

create or replace function public.excluir_recorrencia(p_recorrencia_id uuid)
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
  update public.recorrencias set deleted_at = now()
   where id = p_recorrencia_id and user_id = v_user_id and deleted_at is null;
  if not found then
    raise exception 'Recorrência % não encontrada.', p_recorrencia_id
      using errcode = 'FW404', hint = 'Confira o id; pode já ter sido excluída.';
  end if;
  return jsonb_build_object('recorrencia_id', p_recorrencia_id, 'excluida', true);
end;
$$;

-- Materializa ocorrências vencidas (proxima_data <= hoje) do usuário da
-- sessão. Idempotente por construção: cada ocorrência avança proxima_data
-- na mesma transação em que cria o lançamento. Teto de 12 ocorrências por
-- recorrência por chamada (1 ano de atraso); o que passar disso fica para
-- a próxima chamada — o retorno avisa via "pendentes".
create or replace function public.aplicar_recorrencias()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_hoje    date := (now() at time zone 'America/Sao_Paulo')::date;
  v_rec     record;
  v_res     jsonb;
  v_tx      uuid;
  v_criadas int := 0;
  v_passos  int;
  v_data    date;
begin
  if v_user_id is null then
    raise exception 'Não autenticado.'
      using errcode = 'FW401', hint = 'Sessão ausente/expirada. Não retente; reautentique.';
  end if;

  for v_rec in
    select * from public.recorrencias
     where user_id = v_user_id and ativa and deleted_at is null and proxima_data <= v_hoje
     order by proxima_data
     for update
  loop
    v_passos := 0;
    v_data   := v_rec.proxima_data;
    while v_data <= v_hoje and v_passos < 12 loop
      v_res := public.processar_transacao_completa(
        v_rec.descricao, v_rec.valor, v_rec.tipo, v_rec.forma_pagamento,
        null, v_data, 1
      );
      v_tx := (v_res->>'transacao_id')::uuid;
      if v_rec.categoria_id is not null then
        perform public.definir_categoria_transacao(v_tx, v_rec.categoria_id, false, null);
      end if;
      v_criadas := v_criadas + 1;
      v_passos  := v_passos + 1;
      v_data    := (date_trunc('month', v_data) + interval '1 month')::date + (v_rec.dia_do_mes - 1);
    end loop;
    update public.recorrencias set proxima_data = v_data where id = v_rec.id;
  end loop;

  return jsonb_build_object(
    'transacoes_criadas', v_criadas,
    'pendentes', exists (
      select 1 from public.recorrencias
       where user_id = v_user_id and ativa and deleted_at is null and proxima_data <= v_hoje
    )
  );
end;
$$;

-- ---------------------- privilégios (padrão 0005) ----------------------
revoke execute on function public.criar_recorrencia(text, bigint, text, text, int, uuid, date) from public, anon;
revoke execute on function public.alternar_recorrencia(uuid, boolean)                          from public, anon;
revoke execute on function public.excluir_recorrencia(uuid)                                    from public, anon;
revoke execute on function public.aplicar_recorrencias()                                       from public, anon;
grant  execute on function public.criar_recorrencia(text, bigint, text, text, int, uuid, date) to authenticated;
grant  execute on function public.alternar_recorrencia(uuid, boolean)                          to authenticated;
grant  execute on function public.excluir_recorrencia(uuid)                                    to authenticated;
grant  execute on function public.aplicar_recorrencias()                                       to authenticated;

-- =====================================================================
-- 0016_importacao_formatos.sql
-- A importação (0009) ganhou parsers de OFX, OFC, XLSX e PDF na borda da
-- UI. O pipeline de staging/dedupe/confirmação é o mesmo; aqui só se
-- amplia o rótulo de origem aceito — informativo, mas verdadeiro (não
-- rotular XLSX como "CSV").
-- =====================================================================

alter table public.importacoes
  drop constraint importacoes_origem_check;
alter table public.importacoes
  add constraint importacoes_origem_check
  check (origem in ('CSV','OFX','OFC','XLSX','PDF','PLUGGY'));

-- Mesma função de 0009, mudando apenas a lista de origens válidas.
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
  if p_origem not in ('CSV','OFX','OFC','XLSX','PDF','PLUGGY') then
    raise exception 'origem inválida: %', p_origem
      using errcode = 'FW400', hint = 'Use CSV, OFX, OFC, XLSX, PDF ou PLUGGY.';
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
