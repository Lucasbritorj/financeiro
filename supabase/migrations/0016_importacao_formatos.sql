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
