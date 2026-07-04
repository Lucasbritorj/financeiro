-- =====================================================================
-- 0004_faturas_unique_parcial.sql
-- BLOCKER de soft delete: a UNIQUE (cartao_id, competencia) original ignora
-- deleted_at — uma fatura soft-deletada trava para sempre a recriação da
-- competência (o ON CONFLICT não insere e a transação falha na checagem de
-- integridade). Troca por UNIQUE INDEX parcial sobre faturas ATIVAS.
--
-- Pré-requisito: 0002 já usa "on conflict ... where deleted_at is null",
-- que casa tanto a constraint antiga quanto o índice novo — ordem segura.
-- =====================================================================

-- Localiza a constraint dinamicamente: o nome pode variar entre ambientes.
do $$
declare
  v_constraint text;
begin
  select c.conname into v_constraint
  from pg_constraint c
  where c.conrelid = 'public.faturas'::regclass
    and c.contype = 'u'
    and (select array_agg(a.attname order by a.attname)
           from unnest(c.conkey) as k
           join pg_attribute a
             on a.attrelid = c.conrelid and a.attnum = k)
        = array['cartao_id','competencia']::name[];

  if v_constraint is not null then
    -- DROP CONSTRAINT remove também o índice que a sustentava.
    execute format('alter table public.faturas drop constraint %I', v_constraint);
  end if;
end $$;

-- Unicidade vale apenas entre faturas vivas; soft-deletadas não bloqueiam.
create unique index if not exists faturas_ativas_cartao_competencia_idx
  on public.faturas (cartao_id, competencia)
  where deleted_at is null;
