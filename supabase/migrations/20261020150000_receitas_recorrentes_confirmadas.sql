alter table public.recorrencias
 add column confirmar_recebimento boolean not null default false,
 add column chave_criacao_receita uuid,
 add column hash_criacao_receita text,
 add column pausa_receita_desde date,
 add column pausas_receita datemultirange not null default '{}';
alter table public.recorrencias drop constraint recorrencias_dia_do_mes_check;
alter table public.recorrencias add constraint recorrencias_dia_do_mes_check check(dia_do_mes between 1 and case when finalidade='ASSINATURA' or tipo='RECEITA' then 31 else 28 end);
alter table public.recorrencias drop constraint recorrencias_forma_pagamento_check;
alter table public.recorrencias add constraint recorrencias_forma_pagamento_check check(forma_pagamento in('DEBITO','PIX','DINHEIRO','TRANSFERENCIA'));
update public.recorrencias set confirmar_recebimento=true, forma_pagamento=case when forma_pagamento='DEBITO' then 'TRANSFERENCIA' else forma_pagamento end where tipo='RECEITA' and finalidade='LANCAMENTO';
create unique index recorrencias_chave_receita on public.recorrencias(user_id,chave_criacao_receita,dia_do_mes) where chave_criacao_receita is not null;

create function public.fn_receita_recorrente_confirmada() returns trigger language plpgsql set search_path='' as $$
begin
 if tg_op='UPDATE' and old.confirmar_recebimento and new.tipo<>'RECEITA' then raise exception 'Receita recorrente não muda para despesa. Pause a regra e cadastre outra.' using errcode='FW409';end if;
 new.confirmar_recebimento:=(new.tipo='RECEITA' and new.finalidade='LANCAMENTO');
 if new.confirmar_recebimento and new.forma_pagamento='DEBITO' then new.forma_pagamento:='TRANSFERENCIA';end if;
 if tg_op='UPDATE' and old.confirmar_recebimento then
  -- Para receita, proxima_data é o início contratado, não um cursor.
  new.proxima_data:=old.proxima_data;
  if old.ativa and not new.ativa then new.pausa_receita_desde:=(now() at time zone 'America/Sao_Paulo')::date;
  elsif not old.ativa and new.ativa and old.pausa_receita_desde is not null then
   new.pausas_receita:=old.pausas_receita+datemultirange(daterange(old.pausa_receita_desde,(now() at time zone 'America/Sao_Paulo')::date,'[)'));
   new.pausa_receita_desde:=null;
  end if;
 end if;
 return new;
end $$;
revoke all on function public.fn_receita_recorrente_confirmada() from public,anon,authenticated;
create trigger receita_recorrente_confirmada before insert or update on public.recorrencias for each row execute function public.fn_receita_recorrente_confirmada();

create table public.confirmacoes_receita(
 id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id) on delete cascade,
 chave uuid not null,hash_pedido text not null,transacao_id uuid not null references public.transacoes_origem(id),
 desfeita boolean not null default false,unique(user_id,chave),unique(transacao_id)
);
alter table public.confirmacoes_receita enable row level security;
create policy confirmacoes_receita_select on public.confirmacoes_receita for select using((select auth.uid())=user_id);
revoke all on public.confirmacoes_receita from public,anon,authenticated;
grant select on public.confirmacoes_receita to authenticated;
create table public.ocorrencias_receita(
 id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id) on delete cascade,
 recorrencia_id uuid not null references public.recorrencias(id),competencia date not null,
 data_prevista date not null,descricao text not null,valor bigint not null check(valor between 1 and 999999999999),
 forma text not null check(forma in('PIX','TRANSFERENCIA','DINHEIRO')),categoria_id uuid references public.categorias(id),
 status text not null default 'PREVISTA' check(status in('PREVISTA','RECEBIDA','PULADA')),
 transacao_id uuid references public.transacoes_origem(id),motivo text check(length(motivo)<=2000),
 unique(recorrencia_id,competencia),check((status='RECEBIDA')=(transacao_id is not null))
);
create index ocorrencias_receita_revisao on public.ocorrencias_receita(user_id,competencia,status,id);
alter table public.ocorrencias_receita enable row level security;
create policy ocorrencias_receita_select on public.ocorrencias_receita for select using((select auth.uid())=user_id);
revoke all on public.ocorrencias_receita from public,anon,authenticated;
grant select on public.ocorrencias_receita to authenticated;

create function public.fn_data_receita(p_mes date,p_dia integer) returns date language sql immutable set search_path='' as $$
 select date_trunc('month',p_mes)::date+least(p_dia-1,extract(day from date_trunc('month',p_mes)+interval '1 month - 1 day')::integer-1);
$$;
revoke all on function public.fn_data_receita(date,integer) from public,anon,authenticated;

create or replace function public.fn_proxima_ocorrencia(p_base date,p_dia integer) returns date language sql immutable set search_path='' as $$
 select case when public.fn_data_receita(p_base,p_dia)>=p_base then public.fn_data_receita(p_base,p_dia)
 else public.fn_data_receita((date_trunc('month',p_base)+interval '1 month')::date,p_dia) end;
$$;
revoke all on function public.fn_proxima_ocorrencia(date,integer) from public,anon,authenticated;

-- Preserva o motor de despesas/assinaturas; receitas aguardam confirmação.
do $m$
declare ddl text;alvo text;begin
 ddl:=pg_get_functiondef('public.aplicar_recorrencias()'::regprocedure);
 if strpos(ddl,'and ativa')=0 then raise exception 'Contrato do aplicador mudou.';end if;
 execute replace(ddl,'and ativa','and ativa and not confirmar_recebimento');
 ddl:=pg_get_functiondef('public.editar_recorrencia(uuid,text,bigint,text,text,integer,uuid)'::regprocedure);
 if strpos(ddl,'not between 1 and 28')=0 or strpos(ddl,'make_date(')=0 then raise exception 'Contrato da edição mudou.';end if;
 ddl:=replace(ddl,'not between 1 and 28','not between 1 and (case when p_tipo=''RECEITA'' then 31 else 28 end)');
 ddl:=replace(ddl,'(''DEBITO'',''PIX'',''DINHEIRO'')','(''DEBITO'',''PIX'',''DINHEIRO'',''TRANSFERENCIA'')');
 ddl:=replace(ddl,'make_date(extract(year from v_proxima)::integer,extract(month from v_proxima)::integer,p_dia_do_mes)','public.fn_data_receita(v_proxima,p_dia_do_mes)');
 execute ddl;
end $m$;

create function public.criar_receitas_previstas(p_chave uuid,p_descricao text,p_forma text,p_inicio date,p_partes jsonb,p_categoria_id uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid();h text;ant text;p jsonb;d integer;v bigint;ids jsonb;begin
 if u is null then raise exception 'Não autenticado.' using errcode='FW401';end if;
 if p_chave is null or coalesce(length(trim(p_descricao)),0) not between 1 and 200 or p_forma is null or p_forma not in('PIX','TRANSFERENCIA','DINHEIRO') or p_inicio is null or p_inicio not between '2000-01-01' and '2099-12-31' or jsonb_typeof(p_partes) is distinct from 'array' then raise exception 'Receita recorrente inválida.' using errcode='FW400';end if;
 if jsonb_array_length(p_partes) not between 1 and 31 then raise exception 'Informe até 31 partes.' using errcode='FW400';end if;
 perform pg_advisory_xact_lock(hashtext('receitas-regras:'||u::text));
 for p in select value from jsonb_array_elements(p_partes) loop
  if coalesce(p->>'dia','')!~'^[0-9]{1,2}$' or coalesce(p->>'valor','')!~'^[0-9]{1,12}$' then raise exception 'Dia ou valor inválido.' using errcode='FW400';end if;
  if (p->>'dia')::integer not between 1 and 31 or (p->>'valor')::bigint not between 1 and 999999999999 then raise exception 'Dia ou valor fora do limite.' using errcode='FW400';end if;
 end loop;
 if (select count(distinct (value->>'dia')::integer) from jsonb_array_elements(p_partes))<>jsonb_array_length(p_partes) then raise exception 'Dias repetidos.' using errcode='FW400';end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('regra-receita:'||u::text||p_chave::text,0));
 h:=md5(jsonb_build_array(trim(p_descricao),p_forma,p_inicio,p_partes,p_categoria_id)::text);
 select hash_criacao_receita into ant from public.recorrencias where user_id=u and chave_criacao_receita=p_chave limit 1;
 if found then
  if ant is distinct from h then raise exception 'Tentativa já usada com outros dados.' using errcode='FW409';end if;
 else
  if (select count(*) from public.recorrencias where user_id=u and confirmar_recebimento)+jsonb_array_length(p_partes)>500 then raise exception 'Limite de 500 programações de receita, incluindo histórico.' using errcode='FW409';end if;
  if p_categoria_id is not null then
   perform 1 from public.categorias where id=p_categoria_id and user_id=u and tipo='RECEITA' and deleted_at is null for share;
   if not found then raise exception 'Categoria não encontrada.' using errcode='FW404';end if;
  end if;
  for p in select value from jsonb_array_elements(p_partes) loop
   d:=(p->>'dia')::integer;v:=(p->>'valor')::bigint;
   insert into public.recorrencias(user_id,descricao,valor,tipo,forma_pagamento,dia_do_mes,proxima_data,categoria_id,chave_criacao_receita,hash_criacao_receita)
   values(u,trim(p_descricao),v,'RECEITA',p_forma,d,p_inicio,p_categoria_id,p_chave,h);
  end loop;
 end if;
 select jsonb_agg(id order by dia_do_mes) into ids from public.recorrencias where user_id=u and chave_criacao_receita=p_chave;
 return jsonb_build_object('ids',ids);
end $$;

create function public.consultar_receitas_previstas(p_mes date) returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid();dados jsonb;begin
 if u is null then raise exception 'Não autenticado.' using errcode='FW401';end if;
 if p_mes is null or p_mes not between '2000-01-01' and '2099-12-01' or extract(day from p_mes)<>1 then raise exception 'Informe o primeiro dia do mês.' using errcode='FW400';end if;
 perform pg_advisory_xact_lock(hashtext('receitas-regras:'||u::text));
 if (select count(*) from public.recorrencias where user_id=u and confirmar_recebimento)>500 then raise exception 'Limite de 500 programações de receita, incluindo histórico.' using errcode='FW409';end if;
 insert into public.ocorrencias_receita(user_id,recorrencia_id,competencia,data_prevista,descricao,valor,forma,categoria_id)
 select u,id,p_mes,public.fn_data_receita(p_mes,dia_do_mes),descricao,valor,forma_pagamento,categoria_id
 from public.recorrencias where user_id=u and confirmar_recebimento and deleted_at is null
 and (ativa or public.fn_data_receita(p_mes,dia_do_mes)<pausa_receita_desde)
 and not (public.fn_data_receita(p_mes,dia_do_mes)<@pausas_receita)
 and public.fn_data_receita(p_mes,dia_do_mes)>=proxima_data
 on conflict(recorrencia_id,competencia) do nothing;
 select coalesce(jsonb_agg(to_jsonb(o) order by o.data_prevista,o.id),'[]'::jsonb) into dados from public.ocorrencias_receita o where user_id=u and competencia=p_mes;
 return dados;
end $$;

create function public.confirmar_receitas_previstas(p_chave uuid,p_ids uuid[],p_data date,p_valor bigint,p_observacao text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid();ids uuid[];h text;c public.confirmacoes_receita;o public.ocorrencias_receita;n integer:=0;forma text;categoria uuid;descricao text;tx uuid;begin
 if u is null then raise exception 'Não autenticado.' using errcode='FW401';end if;
 if p_chave is null or coalesce(cardinality(p_ids),0) not between 1 and 62 or p_data is null or p_data not between '2000-01-01' and '2099-12-31' or p_valor is null or p_valor not between 1 and 999999999999 or coalesce(length(p_observacao),0)>2000 then raise exception 'Confirmação inválida.' using errcode='FW400';end if;
 select array_agg(distinct x order by x) into ids from unnest(p_ids) x;
 if cardinality(ids)<>cardinality(p_ids) or array_position(ids,null) is not null then raise exception 'Seleção inválida.' using errcode='FW400';end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('confirmacao-receita:'||u::text||p_chave::text,0));
 h:=md5(jsonb_build_array(ids,p_data,p_valor,nullif(trim(p_observacao),''))::text);
 select * into c from public.confirmacoes_receita where user_id=u and chave=p_chave;
 if found then
  if c.hash_pedido is distinct from h or c.desfeita then raise exception 'Confirmação conflitante ou desfeita. Confira o histórico.' using errcode='FW409';end if;
  return jsonb_build_object('transacao_id',c.transacao_id,'repetida',true);
 end if;
 for o in select * from public.ocorrencias_receita where user_id=u and id=any(ids) order by id for update loop
  n:=n+1;
  if o.status<>'PREVISTA' then raise exception 'Ocorrência já resolvida. Atualize a revisão.' using errcode='FW409';end if;
  if n=1 then forma:=o.forma;categoria:=o.categoria_id;descricao:=o.descricao;
  elsif o.forma<>forma then raise exception 'Recebimentos juntos precisam usar o mesmo meio. Confirme separadamente.' using errcode='FW400';
  elsif o.categoria_id is distinct from categoria then categoria:=null;end if;
 end loop;
 if n<>cardinality(ids) then raise exception 'Ocorrência não encontrada.' using errcode='FW404';end if;
 if categoria is not null and not exists(select 1 from public.categorias where id=categoria and user_id=u and tipo='RECEITA' and deleted_at is null) then categoria:=null;end if;
 tx:=(public.registrar_receita(p_chave,case when n>1 then descricao||' · recebimento conjunto' else descricao end,p_valor,forma,p_data,p_observacao,categoria)->>'transacao_id')::uuid;
 insert into public.confirmacoes_receita(user_id,chave,hash_pedido,transacao_id) values(u,p_chave,h,tx);
 update public.ocorrencias_receita set status='RECEBIDA',transacao_id=tx,motivo=null where user_id=u and id=any(ids);
 return jsonb_build_object('transacao_id',tx,'repetida',false);
end $$;

create function public.marcar_receita_nao_recebida(p_id uuid,p_pular boolean,p_motivo text default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid();o public.ocorrencias_receita;begin
 if u is null then raise exception 'Não autenticado.' using errcode='FW401';end if;
 if p_pular is null or coalesce(length(p_motivo),0)>2000 then raise exception 'Motivo inválido.' using errcode='FW400';end if;
 select * into o from public.ocorrencias_receita where id=p_id and user_id=u for update;
 if not found then raise exception 'Ocorrência não encontrada.' using errcode='FW404';end if;
 if o.status='RECEBIDA' then raise exception 'Desfaça o recebimento antes de pular a data.' using errcode='FW409';end if;
 update public.ocorrencias_receita set status=case when p_pular then 'PULADA' else 'PREVISTA' end,motivo=case when p_pular then nullif(trim(p_motivo),'') else null end where id=o.id;
 return jsonb_build_object('id',o.id);
end $$;

create function public.desfazer_receita_prevista(p_transacao_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid();c public.confirmacoes_receita;begin
 if u is null then raise exception 'Não autenticado.' using errcode='FW401';end if;
 select * into c from public.confirmacoes_receita where user_id=u and transacao_id=p_transacao_id for update;
 if not found then raise exception 'Recebimento não encontrado.' using errcode='FW404';end if;
 if c.desfeita then return jsonb_build_object('desfeita',true);end if;
 perform 1 from public.ocorrencias_receita where user_id=u and transacao_id=c.transacao_id order by id for update;
 update public.confirmacoes_receita set desfeita=true where id=c.id;
 perform public.excluir_transacao(c.transacao_id);
 update public.ocorrencias_receita set status='PREVISTA',transacao_id=null where user_id=u and transacao_id=c.transacao_id;
 update public.confirmacoes_receita set desfeita=true where id=c.id;
 return jsonb_build_object('desfeita',true);
end $$;

-- Ações genéricas de edição/exclusão não podem deixar a agenda dizendo
-- RECEBIDA quando a entrada financeira já mudou ou desapareceu.
create function public.fn_proteger_recebimento_previsto() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if row(new.valor_total,new.tipo,new.forma_pagamento,new.data_compra,new.deleted_at,new.cartao_id,new.num_parcelas)
 is distinct from row(old.valor_total,old.tipo,old.forma_pagamento,old.data_compra,old.deleted_at,old.cartao_id,old.num_parcelas)
 and exists(select 1 from public.confirmacoes_receita where transacao_id=old.id and not desfeita) then
  raise exception 'Receita confirmada pela agenda. Use Desfazer recebimento em Receitas recorrentes antes de editar ou excluir.' using errcode='FW409';
 end if;
 return new;
end $$;
revoke all on function public.fn_proteger_recebimento_previsto() from public,anon,authenticated;
create trigger proteger_recebimento_previsto before update on public.transacoes_origem for each row execute function public.fn_proteger_recebimento_previsto();

revoke all on function public.criar_receitas_previstas(uuid,text,text,date,jsonb,uuid) from public,anon,authenticated;
revoke all on function public.consultar_receitas_previstas(date) from public,anon,authenticated;
revoke all on function public.confirmar_receitas_previstas(uuid,uuid[],date,bigint,text) from public,anon,authenticated;
revoke all on function public.marcar_receita_nao_recebida(uuid,boolean,text) from public,anon,authenticated;
revoke all on function public.desfazer_receita_prevista(uuid) from public,anon,authenticated;
grant execute on function public.criar_receitas_previstas(uuid,text,text,date,jsonb,uuid) to authenticated;
grant execute on function public.consultar_receitas_previstas(date) to authenticated;
grant execute on function public.confirmar_receitas_previstas(uuid,uuid[],date,bigint,text) to authenticated;
grant execute on function public.marcar_receita_nao_recebida(uuid,boolean,text) to authenticated;
grant execute on function public.desfazer_receita_prevista(uuid) to authenticated;
