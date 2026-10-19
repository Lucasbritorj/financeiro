create table public.orcamentos_mensais (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 categoria_id uuid not null references public.categorias(id),
 mes date not null check(extract(day from mes)=1 and mes between '2000-01-01' and '2099-12-01'),
 limite bigint check(limite between 0 and 9007199254740991),
 updated_at timestamptz not null default now(),
 unique(user_id,categoria_id,mes)
);
alter table public.orcamentos_mensais enable row level security;
create policy orcamentos_select on public.orcamentos_mensais for select using(user_id=(select auth.uid()));
revoke all on public.orcamentos_mensais from public,anon,authenticated;
grant select on public.orcamentos_mensais to authenticated;

create function public.salvar_orcamento_mensal(p_categoria_id uuid,p_mes date,p_limite bigint)
returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid();
begin
 if u is null then raise exception 'Não autenticado.' using errcode='FW401';end if;
 if p_mes is null or extract(day from p_mes)<>1 or p_mes not between '2000-01-01' and '2099-12-01' or (p_limite is not null and (p_limite<0 or p_limite>9007199254740991)) then raise exception 'Mês ou limite inválido.' using errcode='FW400';end if;
 perform 1 from public.categorias where id=p_categoria_id and user_id=u and tipo='DESPESA' and deleted_at is null for update;
 if not found then raise exception 'Categoria não encontrada.' using errcode='FW404';end if;
 insert into public.orcamentos_mensais(user_id,categoria_id,mes,limite) values(u,p_categoria_id,p_mes,p_limite)
 on conflict(user_id,categoria_id,mes) do update set limite=excluded.limite,updated_at=clock_timestamp();
 return jsonb_build_object('salvo',true);
end $$;
revoke all on function public.salvar_orcamento_mensal(uuid,date,bigint) from public,anon,authenticated;
grant execute on function public.salvar_orcamento_mensal(uuid,date,bigint) to authenticated;

create function public.consultar_orcamentos_mensais(p_mes date)
returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); resultado jsonb;
begin
 if u is null then raise exception 'Não autenticado.' using errcode='FW401';end if;
 if p_mes is null or extract(day from p_mes)<>1 or p_mes not between '2000-01-01' and '2099-12-01' then raise exception 'Mês inválido.' using errcode='FW400';end if;
 select coalesce(jsonb_agg(to_jsonb(r) order by r.nome),'[]') into resultado from (
 select c.id,c.nome,c.orcamento_mensal as padrao,(o.id is not null) as definido,
 case when o.id is not null then o.limite else c.orcamento_mensal end as limite,
 coalesce(g.gasto,0) as gasto
 from public.categorias c left join public.orcamentos_mensais o on o.categoria_id=c.id and o.user_id=u and o.mes=p_mes
 left join (select (m.categorias->>'id')::uuid as categoria_id,sum(m.valor_total) as gasto
 from public.vw_movimentos_competencia m where m.user_id=u and m.tipo='DESPESA' and m.natureza='CONSUMO'
 and m.data_compra>=p_mes and m.data_compra<(p_mes+interval '1 month') group by 1) g on g.categoria_id=c.id
 where c.user_id=u and c.deleted_at is null and c.tipo='DESPESA') r;
 return resultado;
end $$;
revoke all on function public.consultar_orcamentos_mensais(date) from public,anon,authenticated;
grant execute on function public.consultar_orcamentos_mensais(date) to authenticated;

-- Os mesmos limites efetivos alimentam Dashboard e Análise pela competência.
create or replace view public.vw_movimentos_competencia with(security_invoker=true) as
 select t.id,t.user_id,t.descricao,t.valor_total,t.tipo,t.data_compra,t.natureza,
 case when cat.id is null then null else jsonb_build_object('id',cat.id,'nome',cat.nome,'cor',cat.cor,'orcamento_mensal',case when o.id is not null then o.limite else cat.orcamento_mensal end) end as categorias
 from public.transacoes_origem t
 left join public.categorias cat on cat.id=t.categoria_id and cat.user_id=t.user_id and cat.deleted_at is null
 left join public.orcamentos_mensais o on o.user_id=t.user_id and o.categoria_id=cat.id and o.mes=date_trunc('month',t.data_compra)::date
 where t.deleted_at is null and t.forma_pagamento<>'CREDITO'
 union all
 select p.id,t.user_id,t.descricao,p.valor,t.tipo,p.data_competencia,t.natureza,
 case when cat.id is null then null else jsonb_build_object('id',cat.id,'nome',cat.nome,'cor',cat.cor,'orcamento_mensal',case when o.id is not null then o.limite else cat.orcamento_mensal end) end
 from public.parcelas p join public.transacoes_origem t on t.id=p.transacao_id and t.user_id=p.user_id and t.deleted_at is null
 left join public.categorias cat on cat.id=t.categoria_id and cat.user_id=t.user_id and cat.deleted_at is null
 left join public.orcamentos_mensais o on o.user_id=t.user_id and o.categoria_id=cat.id and o.mes=date_trunc('month',p.data_competencia)::date
 where p.deleted_at is null and t.forma_pagamento='CREDITO';
revoke all on public.vw_movimentos_competencia from public,anon,authenticated;
grant select on public.vw_movimentos_competencia to authenticated;
