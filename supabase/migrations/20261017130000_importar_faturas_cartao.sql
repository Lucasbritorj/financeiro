-- Faturas importadas: cobranças efetivas no razão; previsões somente em view.
create table public.lotes_fatura (
 id uuid primary key, user_id uuid not null references auth.users(id) on delete cascade,
 cartao_id uuid not null references public.cartoes_credito(id), competencia date not null,
 arquivo_sha256 text check(arquivo_sha256 is null or arquivo_sha256 ~ '^[a-f0-9]{64}$'),
 conteudo_hash text not null, origem text not null check(origem in ('PDF','CSV','OFX','OFC','XLSX')),
 resultado jsonb not null default '{}', created_at timestamptz not null default now(),
 check(extract(day from competencia)=1)
);
create unique index lotes_fatura_arquivo_idx on public.lotes_fatura(user_id,cartao_id,competencia,arquivo_sha256) where arquivo_sha256 is not null;
create index lotes_fatura_user_idx on public.lotes_fatura(user_id);
create table public.planos_parcelamento (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
 cartao_id uuid not null references public.cartoes_credito(id), descricao text not null,
 competencia_base date not null check(extract(day from competencia_base)=1),
 parcela_base int not null, parcelas_total int not null,
 valor_previsto bigint not null check(valor_previsto between 1 and 999999999999),
 created_at timestamptz not null default now(),
 check(parcela_base between 1 and parcelas_total and parcelas_total between 2 and 120)
);
create index planos_parcelamento_user_cartao_idx on public.planos_parcelamento(user_id,cartao_id);
create table public.cobrancas_importadas (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
 lote_id uuid not null references public.lotes_fatura(id),
 cartao_id uuid not null references public.cartoes_credito(id), competencia date not null,
 transacao_id uuid not null unique references public.transacoes_origem(id) on delete cascade,
 plano_id uuid references public.planos_parcelamento(id), parcela_numero int,
 assinatura_id uuid references public.recorrencias(id),
 data date not null, descricao text not null, valor bigint not null,
 fingerprint text not null, id_externo text,
 unique(user_id,cartao_id,competencia,fingerprint), unique(plano_id,parcela_numero)
);
create index cobrancas_importadas_user_cartao_idx on public.cobrancas_importadas(user_id,cartao_id,competencia);
create unique index cobrancas_importadas_externo_idx on public.cobrancas_importadas(user_id,cartao_id,competencia,id_externo) where id_externo is not null;
create index cobrancas_importadas_assinatura_idx on public.cobrancas_importadas(assinatura_id);
alter table public.lotes_fatura enable row level security;
alter table public.planos_parcelamento enable row level security;
alter table public.cobrancas_importadas enable row level security;
create policy lotes_fatura_select on public.lotes_fatura for select using(user_id=(select auth.uid()));
create policy planos_parcelamento_select on public.planos_parcelamento for select using(user_id=(select auth.uid()));
create policy cobrancas_importadas_select on public.cobrancas_importadas for select using(user_id=(select auth.uid()));
revoke all on public.lotes_fatura,public.planos_parcelamento,public.cobrancas_importadas from anon,authenticated;
grant select on public.lotes_fatura,public.planos_parcelamento,public.cobrancas_importadas to authenticated;

create view public.vw_previsoes_parcelamento with(security_invoker=true) as
 select p.id::text||'-'||n.numero::text as id,p.user_id,p.id as plano_id,p.cartao_id,p.descricao,n.numero,
   (p.competencia_base+make_interval(months=>n.numero-p.parcela_base))::date as competencia,
   p.valor_previsto as valor
 from public.planos_parcelamento p
 join public.cartoes_credito c on c.id=p.cartao_id and c.user_id=p.user_id and c.deleted_at is null
 cross join lateral generate_series(p.parcela_base+1,p.parcelas_total) n(numero)
 where not exists(select 1 from public.cobrancas_importadas ci
   join public.transacoes_origem t on t.id=ci.transacao_id and t.deleted_at is null
   where ci.plano_id=p.id and ci.parcela_numero=n.numero);
revoke all on public.vw_previsoes_parcelamento from anon,authenticated;
grant select on public.vw_previsoes_parcelamento to authenticated;

create function public.confirmar_fatura_importada(
 p_chave uuid,p_sha text,p_cartao_id uuid,p_competencia date,p_origem text,p_linhas jsonb,
 p_total bigint default null,p_conferido boolean default false
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
 u uuid:=auth.uid(); c public.cartoes_credito%rowtype; lote public.lotes_fatura%rowtype;
 plano public.planos_parcelamento%rowtype; linha jsonb; item record;
 fid uuid; tid uuid; pid uuid; aid uuid; v bigint; total bigint:=0; criadas int:=0; duplicadas int:=0;
 numero int; quantidade int; ordinal int; fp text; ext text; descricao text; tipo text; d date;
 hash text; vencimento date; candidato boolean; assinatura_decisao text;
begin
 if u is null then raise exception 'Não autenticado.' using errcode='FW401'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(u::text,601607));
 if p_chave is null or p_competencia is null or extract(day from p_competencia)<>1
   or p_competencia not between date '2000-01-01' and date '2100-12-01'
   or p_origem is null or p_origem not in ('PDF','CSV','OFX','OFC','XLSX')
   or (p_sha is not null and p_sha !~ '^[a-f0-9]{64}$') then
   raise exception 'Contexto de fatura inválido.' using errcode='FW400';
 end if;
 if p_linhas is null or jsonb_typeof(p_linhas)<>'array' then raise exception 'Linhas inválidas.' using errcode='FW400'; end if;
 if jsonb_array_length(p_linhas) not between 1 and 1000 then raise exception 'Revise entre 1 e 1000 linhas.' using errcode='FW400'; end if;
 hash:=md5(jsonb_build_array(p_cartao_id,p_competencia,p_origem,p_linhas,p_total)::text);
 select * into lote from public.lotes_fatura where id=p_chave;
 if found then
   if lote.user_id<>u or lote.conteudo_hash<>hash then raise exception 'Chave já usada por outro conteúdo.' using errcode='FW409'; end if;
   return lote.resultado||jsonb_build_object('repetida',true);
 end if;
 select * into lote from public.lotes_fatura where user_id=u and cartao_id=p_cartao_id
   and competencia=p_competencia and arquivo_sha256=p_sha;
 if found then return lote.resultado||jsonb_build_object('repetida',true); end if;
 select * into c from public.cartoes_credito where id=p_cartao_id and user_id=u and deleted_at is null for update;
 if not found then raise exception 'Cartão não encontrado.' using errcode='FW404'; end if;
 -- Validar todas as linhas antes de gravar; a função é uma transação única.
 for linha in select value from jsonb_array_elements(p_linhas) loop
   if coalesce((linha->>'ignorar')::boolean,false) then continue; end if;
   tipo:=linha->>'tipo';
   if linha->>'natureza_valor'='CREDITO' or (linha->>'natureza_valor'='DESCONHECIDA' and not coalesce((linha->>'sinal_confirmado')::boolean,false)) then raise exception 'Crédito bloqueado ou sinal ainda não confirmado.' using errcode='FW400'; end if;
   if tipo is null or tipo not in ('GASTO','PARCELA','ASSINATURA') then raise exception 'Exclua pagamentos, totais e créditos da importação de compras.' using errcode='FW400'; end if;
   if jsonb_typeof(linha->'valor')<>'number' or coalesce(linha->>'valor','') !~ '^[0-9]{1,12}$' then raise exception 'Valor deve ser inteiro em centavos.' using errcode='FW400'; end if;
   v:=(linha->>'valor')::bigint;
   if v not between 1 and 999999999999 or length(trim(coalesce(linha->>'descricao',''))) not between 1 and 500 then raise exception 'Valor ou descrição inválidos.' using errcode='FW400'; end if;
   if coalesce(linha->>'data','') !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'Data inválida.' using errcode='FW400'; end if;
   d:=(linha->>'data')::date;
   if d<date '2000-01-01' or d>=p_competencia+interval '2 months' then raise exception 'Data incompatível com a fatura.' using errcode='FW400'; end if;
   if nullif(linha->>'categoria_id','') is not null then
     perform 1 from public.categorias cat where cat.id=(linha->>'categoria_id')::uuid and cat.user_id=u and cat.tipo='DESPESA' and cat.deleted_at is null for update;
     if not found then raise exception 'Categoria não encontrada.' using errcode='FW404'; end if;
   end if;
   total:=total+v;
 end loop;
 if total=0 then raise exception 'Nenhuma cobrança selecionada.' using errcode='FW400'; end if;
 if p_total is not null and p_total<>total and not coalesce(p_conferido,false) then raise exception 'Total diferente da fatura. Revise e reconheça a diferença.' using errcode='FW400'; end if;
 insert into public.lotes_fatura(id,user_id,cartao_id,competencia,arquivo_sha256,conteudo_hash,origem)
 values(p_chave,u,p_cartao_id,p_competencia,p_sha,hash,p_origem);
 select id into fid from public.faturas where cartao_id=p_cartao_id and competencia=p_competencia and user_id=u and deleted_at is null for update;
 if found and exists(select 1 from public.faturas where id=fid and status<>'ABERTA') then raise exception 'Fatura fechada ou paga. Reabra antes de importar.' using errcode='FW409'; end if;
 if fid is null then
   vencimento:=p_competencia+(least(c.dia_vencimento,extract(day from(p_competencia+interval '1 month -1 day'))::int)-1);
   insert into public.faturas(user_id,cartao_id,competencia,data_vencimento) values(u,p_cartao_id,p_competencia,vencimento) returning id into fid;
 end if;
 for item in
   select e.value as l, row_number() over(partition by e.value->>'data',e.value->>'valor',public.fn_normalizar_descricao(e.value->>'descricao') order by e.ord) as ordinal
   from jsonb_array_elements(p_linhas) with ordinality e(value,ord)
   where not coalesce((e.value->>'ignorar')::boolean,false)
 loop
   linha:=item.l; v:=(linha->>'valor')::bigint; d:=(linha->>'data')::date;
   descricao:=trim(linha->>'descricao');tipo:=linha->>'tipo';ordinal:=item.ordinal;
   ext:=nullif(trim(linha->>'id_externo'),'');
   if length(coalesce(ext,''))>300 then raise exception 'Identificador externo muito longo.' using errcode='FW400'; end if;
   fp:=md5(jsonb_build_array(p_cartao_id,p_competencia,d,v,public.fn_normalizar_descricao(descricao),ordinal)::text);
   if ext is not null and exists(select 1 from public.cobrancas_importadas ci where ci.user_id=u and ci.cartao_id=p_cartao_id and ci.competencia=p_competencia and ci.id_externo=ext) then
     if exists(select 1 from public.cobrancas_importadas ci where ci.user_id=u and ci.cartao_id=p_cartao_id and ci.competencia=p_competencia and ci.id_externo=ext and ci.valor<>v) then raise exception 'Identificador externo com valor diferente. Revise o arquivo.' using errcode='FW409'; end if;
     duplicadas:=duplicadas+1;continue;
   end if;
   if exists(select 1 from public.cobrancas_importadas ci where ci.user_id=u and ci.cartao_id=p_cartao_id and ci.competencia=p_competencia and ci.fingerprint=fp) then
     if coalesce(linha->>'decisao_duplicidade','')='NOVA' then
       -- Confirmação explícita de uma compra legítima igual; retry do mesmo lote continua idempotente.
       fp:=md5(jsonb_build_array('nova-confirmada',fp,p_chave,ordinal)::text);
     else duplicadas:=duplicadas+1;continue; end if;
   end if;
   candidato:=exists(select 1 from public.transacoes_origem t join public.parcelas pa on pa.transacao_id=t.id and pa.deleted_at is null
     where t.user_id=u and t.cartao_id=p_cartao_id and t.data_compra=d and pa.valor=v and t.deleted_at is null and pa.fatura_id=fid);
   if candidato and coalesce(linha->>'decisao_duplicidade','')<>'NOVA' then raise exception 'Cobrança semelhante já existe. Confirme como nova ou exclua na revisão.' using errcode='FW409'; end if;
   pid:=null;aid:=null;numero:=null;
   if tipo='PARCELA' then
     if coalesce(linha->>'parcela_numero','') !~ '^\d{1,3}$' or coalesce(linha->>'parcelas_total','') !~ '^\d{1,3}$' then raise exception 'Parcelamento inválido.' using errcode='FW400'; end if;
     numero:=(linha->>'parcela_numero')::int;quantidade:=(linha->>'parcelas_total')::int;
     if numero<1 or quantidade not between 2 and 120 or numero>quantidade then raise exception 'Parcelamento inválido.' using errcode='FW400'; end if;
     pid:=nullif(linha->>'plano_id','')::uuid;
     if pid is not null then
       select * into plano from public.planos_parcelamento where id=pid and user_id=u and cartao_id=p_cartao_id for update;
       if not found then raise exception 'Parcelamento não encontrado.' using errcode='FW404'; end if;
       if plano.parcelas_total<>quantidade or p_competencia<>(plano.competencia_base+make_interval(months=>numero-plano.parcela_base))::date then raise exception 'Parcela não corresponde ao mês/total do plano.' using errcode='FW400'; end if;
       if exists(select 1 from public.cobrancas_importadas where plano_id=pid and parcela_numero=numero) then
         raise exception 'Parcela já confirmada nesse plano. Revise o vínculo.' using errcode='FW409';
       end if;
     else
       if exists(select 1 from public.planos_parcelamento where user_id=u and cartao_id=p_cartao_id and parcelas_total=quantidade)
          and coalesce(linha->>'decisao_duplicidade','')<>'NOVA' then raise exception 'Há parcelamento compatível. Escolha vínculo ou confirme um novo plano.' using errcode='FW409'; end if;
       insert into public.planos_parcelamento(user_id,cartao_id,descricao,competencia_base,parcela_base,parcelas_total,valor_previsto)
       values(u,p_cartao_id,descricao,p_competencia,numero,quantidade,v) returning id into pid;
     end if;
   elsif tipo='ASSINATURA' then
     assinatura_decisao:=linha->>'decisao_assinatura';
     if assinatura_decisao='VINCULAR' then
       aid:=nullif(linha->>'assinatura_id','')::uuid;
       perform 1 from public.recorrencias where id=aid and user_id=u and cartao_id=p_cartao_id and finalidade='ASSINATURA' and status='ATIVA' and deleted_at is null for update;
       if not found then raise exception 'Assinatura ativa desse cartão não encontrada.' using errcode='FW404'; end if;
     elsif assinatura_decisao='NOVA' then
       aid:=(public.criar_assinatura(descricao,v,linha->>'periodicidade',(linha->>'proxima_cobranca')::date,nullif(linha->>'categoria_id','')::uuid,p_cartao_id)->>'assinatura_id')::uuid;
     elsif assinatura_decisao is distinct from 'NAO' then raise exception 'Confirme a possível assinatura.' using errcode='FW400'; end if;
   end if;
   insert into public.transacoes_origem(user_id,descricao,valor_total,tipo,forma_pagamento,cartao_id,data_compra,num_parcelas,categoria_id,source,fingerprint)
   values(u,descricao,v,'DESPESA','CREDITO',p_cartao_id,d,1,nullif(linha->>'categoria_id','')::uuid,p_origem,'fatura:'||fp) returning id into tid;
   insert into public.parcelas(user_id,transacao_id,fatura_id,numero,valor,data_competencia) values(u,tid,fid,1,v,p_competencia);
   insert into public.cobrancas_importadas(user_id,lote_id,cartao_id,competencia,transacao_id,plano_id,parcela_numero,assinatura_id,data,descricao,valor,fingerprint,id_externo)
   values(u,p_chave,p_cartao_id,p_competencia,tid,pid,numero,aid,d,descricao,v,fp,ext);
   criadas:=criadas+1;
 end loop;
 update public.lotes_fatura set resultado=jsonb_build_object('lote_id',p_chave,'criadas',criadas,'duplicadas',duplicadas,'repetida',false) where id=p_chave returning * into lote;
 return lote.resultado;
exception
 when invalid_text_representation or invalid_datetime_format or datetime_field_overflow or numeric_value_out_of_range then raise exception 'Campos inválidos na revisão da fatura.' using errcode='FW400';
 when unique_violation then raise exception 'Cobrança já registrada ou lote concorrente. Recarregue a revisão.' using errcode='FW409';
end;
$$;
revoke all on function public.confirmar_fatura_importada(uuid,text,uuid,date,text,jsonb,bigint,boolean) from public,anon;
grant execute on function public.confirmar_fatura_importada(uuid,text,uuid,date,text,jsonb,bigint,boolean) to authenticated;

create function public.editar_previsao_parcelamento(p_plano_id uuid,p_valor bigint)
returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid();
begin
 if u is null then raise exception 'Não autenticado.' using errcode='FW401'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(u::text,601607));
 if p_valor is null or p_valor not between 1 and 999999999999 then raise exception 'Valor previsto inválido.' using errcode='FW400'; end if;
 update public.planos_parcelamento set valor_previsto=p_valor where id=p_plano_id and user_id=u;
 if not found then raise exception 'Plano não encontrado.' using errcode='FW404'; end if;
 return jsonb_build_object('plano_id',p_plano_id);
end $$;
revoke all on function public.editar_previsao_parcelamento(uuid,bigint) from public,anon;
grant execute on function public.editar_previsao_parcelamento(uuid,bigint) to authenticated;
