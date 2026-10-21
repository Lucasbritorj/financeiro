-- Contadores privados: somente a API do servidor pode consumir a cota.
create table public.limites_servidor(chave text not null,acao text not null,inicio timestamptz not null,total integer not null check(total>0),primary key(chave,acao));
alter table public.limites_servidor enable row level security;
create index limites_servidor_expiracao on public.limites_servidor(inicio);
revoke all on public.limites_servidor from public,anon,authenticated;

create function public.consumir_limite_servidor(p_chave text,p_acao text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare limite integer;janela integer;n integer;inicio_janela timestamptz;agora timestamptz:=clock_timestamp();begin
 if p_chave is null or p_chave !~ '^[a-f0-9]{64}$' then raise exception 'Identificador inválido.' using errcode='FW400';end if;
 select x.l,x.j into limite,janela from(values('auth_ip',100,600),('entrar',10,600),('cadastrar',3,3600),('recuperar',3,3600),('senha',5,3600),('sair',20,600),('dados',240,60),('pluggy',6,60),('exportar',10,60))x(a,l,j) where x.a=p_acao;
 if limite is null then raise exception 'Operação inválida.' using errcode='FW400';end if;
 inicio_janela:=to_timestamp(floor(extract(epoch from agora)/janela)*janela);
 insert into public.limites_servidor as c values(p_chave,p_acao,inicio_janela,1)
 on conflict(chave,acao) do update set inicio=excluded.inicio,total=case when c.inicio=excluded.inicio then least(c.total+1,limite+1) else 1 end returning total into n;
 -- Janela de inatividade de 48h evita acumular identificadores indefinidamente.
 delete from public.limites_servidor where inicio<agora-interval '48 hours';
 return jsonb_build_object('permitido',n<=limite,'aguardar',greatest(1,ceil(extract(epoch from inicio_janela+make_interval(secs=>janela)-agora))::integer));
end $$;
revoke all on function public.consumir_limite_servidor(text,text) from public,anon,authenticated;
grant execute on function public.consumir_limite_servidor(text,text) to service_role;
