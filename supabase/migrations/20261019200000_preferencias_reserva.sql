-- Somente preferências: esta migração não altera saldos ou lançamentos.
create table public.preferencias_reserva (
 user_id uuid primary key references auth.users(id) on delete cascade,
 dados jsonb not null check(jsonb_typeof(dados)='object' and octet_length(dados::text)<=24000),
 updated_at timestamptz not null default now()
);
alter table public.preferencias_reserva enable row level security;
create policy preferencias_reserva_select on public.preferencias_reserva for select using(user_id=(select auth.uid()));
revoke all on public.preferencias_reserva from public,anon,authenticated;
grant select on public.preferencias_reserva to authenticated;

create function public.salvar_preferencias_reserva(p_dados jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); k text; n numeric; item record;
begin
 if u is null then raise exception 'Não autenticado.' using errcode='FW401';end if;
 if p_dados is null or jsonb_typeof(p_dados)<>'object' or octet_length(p_dados::text)>24000 then raise exception 'Preferências inválidas.' using errcode='FW400';end if;
 if cardinality(array(select jsonb_object_keys(p_dados)))<>7 or not p_dados ?& array['intencao','margem','caixa','compromissos','receita','gasto','prioridades'] then raise exception 'Campos inválidos.' using errcode='FW400';end if;
 foreach k in array array['intencao','margem','caixa','compromissos','receita','gasto'] loop
  if p_dados->k='null'::jsonb and k in ('caixa','receita','gasto') then continue;end if;
  if jsonb_typeof(p_dados->k)<>'number' then raise exception 'Valor inválido.' using errcode='FW400';end if;
  n:=(p_dados->>k)::numeric;
  if n<0 or n>1000000000000 or n<>trunc(n) then raise exception 'Centavos inválidos.' using errcode='FW400';end if;
 end loop;
 if jsonb_typeof(p_dados->'prioridades')<>'object' then raise exception 'Prioridades inválidas.' using errcode='FW400';end if;
 if cardinality(array(select jsonb_object_keys(p_dados->'prioridades')))>200 then raise exception 'Muitas prioridades.' using errcode='FW400';end if;
 for item in select key,value from jsonb_each(p_dados->'prioridades') loop
  if item.key !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' or item.value not in ('1'::jsonb,'2'::jsonb,'3'::jsonb) then raise exception 'Prioridade inválida.' using errcode='FW400';end if;
  perform 1 from public.cofrinhos where id=item.key::uuid and user_id=u and deleted_at is null and not arquivado for share;
  if not found then raise exception 'Cofrinho não encontrado.' using errcode='FW404';end if;
 end loop;
 insert into public.preferencias_reserva(user_id,dados) values(u,p_dados)
 on conflict(user_id) do update set dados=excluded.dados,updated_at=clock_timestamp();
 return jsonb_build_object('salvo',true);
end $$;
revoke all on function public.salvar_preferencias_reserva(jsonb) from public,anon,authenticated;
grant execute on function public.salvar_preferencias_reserva(jsonb) to authenticated;
