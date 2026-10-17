-- Vínculos explícitos para novas importações; nenhuma inferência retroativa por data/valor.
alter table public.transacoes_origem add column importacao_id uuid references public.importacoes(id);
create index transacoes_importacao_idx on public.transacoes_origem(importacao_id) where importacao_id is not null;
alter table public.importacoes add column vinculo_reversao boolean not null default false;
alter table public.importacoes add column transacoes_criadas integer;
alter table public.lotes_fatura add column desfeita_em timestamptz;
alter table public.planos_parcelamento add column lote_criador_id uuid references public.lotes_fatura(id);
drop index public.lotes_fatura_arquivo_idx;
create unique index lotes_fatura_arquivo_idx on public.lotes_fatura(user_id,cartao_id,competencia,arquivo_sha256)
 where arquivo_sha256 is not null and desfeita_em is null;

create table public.reversoes_importacao (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
 tipo text not null check(tipo in ('FATURA','EXTRATO')), lote_id uuid not null,
 resumo jsonb not null, created_at timestamptz not null default now(), unique(user_id,tipo,lote_id)
);
alter table public.reversoes_importacao enable row level security;
create policy reversoes_select on public.reversoes_importacao for select using(user_id=(select auth.uid()));
revoke all on public.reversoes_importacao from public,anon,authenticated;
grant select on public.reversoes_importacao to authenticated;

create view public.vw_historico_importacoes with(security_invoker=true) as
 select 'FATURA:'||l.id::text as id,l.id as lote_id,l.user_id,'FATURA'::text as tipo,l.origem,
 l.competencia,l.cartao_id,l.created_at,l.desfeita_em,
 coalesce((l.resultado->>'criadas')::int,0) as quantidade
 from public.lotes_fatura l
 union all
 select 'EXTRATO:'||i.id::text,i.id,i.user_id,'EXTRATO',i.origem,null::date,null::uuid,i.created_at,null::timestamptz,
 i.transacoes_criadas from public.importacoes i where i.status='CONFIRMADA' and i.deleted_at is null
 union all
 select 'EXTRATO:'||r.lote_id::text,r.lote_id,r.user_id,'EXTRATO',r.resumo->>'origem',null::date,null::uuid,
 (r.resumo->>'criado_em')::timestamptz,r.created_at,(r.resumo->>'quantidade')::int
 from public.reversoes_importacao r where r.tipo='EXTRATO';
revoke all on public.vw_historico_importacoes from public,anon,authenticated;
grant select on public.vw_historico_importacoes to authenticated;

create view public.vw_parcelas_planejamento with(security_invoker=true) as
 select p.id,p.user_id,t.cartao_id,p.data_competencia as competencia,p.valor
 from public.parcelas p join public.transacoes_origem t on t.id=p.transacao_id and t.user_id=p.user_id
 join public.cartoes_credito c on c.id=t.cartao_id and c.user_id=t.user_id
 where p.deleted_at is null and t.deleted_at is null and c.deleted_at is null and t.forma_pagamento='CREDITO';
create view public.vw_cobrancas_assinaturas with(security_invoker=true) as
 select c.id,c.user_id,c.cartao_id,c.competencia,c.valor,c.assinatura_id,c.data
 from public.cobrancas_importadas c join public.transacoes_origem t on t.id=c.transacao_id and t.user_id=c.user_id
 where t.deleted_at is null and c.assinatura_id is not null;
revoke all on public.vw_parcelas_planejamento,public.vw_cobrancas_assinaturas from public,anon,authenticated;
grant select on public.vw_parcelas_planejamento,public.vw_cobrancas_assinaturas to authenticated;

-- Somente leitura. Token detecta mudança entre a prévia e a confirmação.
create function public.consultar_reversao_importacao(p_tipo text,p_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 u uuid:=auth.uid(); ids uuid[]; esperado integer; motivo text; info jsonb; linhas jsonb; versoes jsonb;
 contratos integer:=0; planos integer:=0; total bigint; receitas bigint; despesas bigint; anterior jsonb;
 planos_snapshot jsonb; previsoes_removidas bigint:=0;
begin
 if u is null then raise exception 'Não autenticado.' using errcode='FW401';end if;
 if p_tipo is null or p_tipo not in ('FATURA','EXTRATO') or p_id is null then raise exception 'Importação inválida.' using errcode='FW400';end if;
 select resumo into anterior from public.reversoes_importacao where user_id=u and tipo=p_tipo and lote_id=p_id;
 if found then return anterior||jsonb_build_object('permitido',false,'desfeita',true,'motivo','Esta importação já foi desfeita.');end if;
 if p_tipo='FATURA' then
  select jsonb_build_object('origem',l.origem,'criado_em',l.created_at,'cartao_id',l.cartao_id,'competencia',l.competencia),coalesce((l.resultado->>'criadas')::int,0)
   into info,esperado from public.lotes_fatura l where l.id=p_id and l.user_id=u;
  if not found then raise exception 'Importação não encontrada.' using errcode='FW404';end if;
  select array_agg(c.transacao_id),count(distinct c.assinatura_id)::int into ids,contratos from public.cobrancas_importadas c where c.lote_id=p_id and c.user_id=u;
  select count(*)::int into planos from public.planos_parcelamento p where p.lote_criador_id=p_id and p.user_id=u
   and not exists(select 1 from public.cobrancas_importadas c where c.plano_id=p.id and c.lote_id<>p_id);
  if exists(select 1 from public.cobrancas_importadas c join public.planos_parcelamento p on p.id=c.plano_id
   where c.lote_id=p_id and c.user_id=u and p.lote_criador_id is null) then
   motivo:='O lote usa parcelamento antigo sem procedência suficiente para reverter as previsões com segurança.';
  end if;
  select coalesce(jsonb_agg(jsonb_build_array(p.id,p.valor_previsto,p.parcelas_total) order by p.id),'[]') into planos_snapshot
   from public.planos_parcelamento p where p.lote_criador_id=p_id and p.user_id=u;
  select coalesce(sum(v.valor),0) into previsoes_removidas from public.vw_previsoes_parcelamento v
   join public.planos_parcelamento p on p.id=v.plano_id and p.user_id=u where p.lote_criador_id=p_id
   and not exists(select 1 from public.cobrancas_importadas c where c.plano_id=p.id and c.lote_id<>p_id);
 else
  select jsonb_build_object('origem',i.origem,'criado_em',i.created_at),i.transacoes_criadas,
   case when not i.vinculo_reversao then 'Extrato antigo sem vínculo comprovado. A reversão automática está bloqueada.'
    when i.status<>'CONFIRMADA' then 'A importação ainda não foi confirmada.' end
   into info,esperado,motivo from public.importacoes i where i.id=p_id and i.user_id=u and i.deleted_at is null;
  if not found then raise exception 'Importação não encontrada.' using errcode='FW404';end if;
  select array_agg(t.id) into ids from public.transacoes_origem t where t.importacao_id=p_id and t.user_id=u;
 end if;
 ids:=coalesce(ids,array[]::uuid[]);
 if motivo is null and cardinality(ids)<>esperado then motivo:='Os vínculos do lote foram alterados. A reversão automática está bloqueada.';end if;
 if motivo is null and exists(
  select 1 from public.parcelas p left join public.faturas f on f.id=p.fatura_id and f.user_id=u
  where p.transacao_id=any(ids) and p.user_id=u and (p.status='PAGA' or f.status<>'ABERTA')
 ) then motivo:='Há pagamento ou fatura fechada/paga. Reabra ou estorne pela tela correspondente antes de desfazer.';end if;
 if motivo is null and exists(select 1 from public.transacoes_origem t where t.id=any(ids) and t.user_id=u
  and (t.deleted_at is not null or t.updated_at<>t.created_at or t.natureza='LIQUIDACAO_FATURA' or t.fatura_liquidada_id is not null)) then
  motivo:='Há lançamento editado, removido ou ligado a pagamento de fatura. A reversão automática está bloqueada.';end if;
 if motivo is null and exists(select 1 from public.parcelas p where p.transacao_id=any(ids) and p.user_id=u
  and (p.deleted_at is not null or p.updated_at<>p.created_at)) then motivo:='Há parcelas alteradas após a importação. Confira o histórico antes de desfazer.';end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',t.id,'descricao',t.descricao,'data',t.data_compra,'valor',t.valor_total,'tipo',t.tipo) order by t.id),'[]'),
  coalesce(sum(t.valor_total),0),coalesce(sum(t.valor_total) filter(where t.tipo='RECEITA'),0),coalesce(sum(t.valor_total) filter(where t.tipo='DESPESA'),0)
  into linhas,total,receitas,despesas from public.transacoes_origem t where t.id=any(ids) and t.user_id=u;
 select coalesce(jsonb_agg(jsonb_build_array(t.id,t.updated_at,t.deleted_at,p.id,p.valor,p.updated_at,p.deleted_at,p.status,f.id,f.status,f.updated_at) order by t.id,p.id),'[]')
  into versoes from public.transacoes_origem t left join public.parcelas p on p.transacao_id=t.id and p.user_id=u
  left join public.faturas f on f.id=p.fatura_id and f.user_id=u where t.id=any(ids) and t.user_id=u;
 return info||jsonb_build_object('permitido',motivo is null,'motivo',motivo,'desfeita',false,'tipo',p_tipo,'lote_id',p_id,
  'quantidade',case when esperado is null then null else cardinality(ids) end,'total',total,'receitas',receitas,'despesas',despesas,'assinaturas_preservadas',contratos,'planos_removidos',planos,
  'previsoes_removidas',previsoes_removidas,'lancamentos',linhas,
  'token',md5(jsonb_build_array(p_tipo,p_id,linhas,versoes,contratos,planos,planos_snapshot,previsoes_removidas)::text));
end $$;

create function public.desfazer_importacao(p_tipo text,p_id uuid,p_token text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); previa jsonb; anterior jsonb; ids uuid[]; cartao uuid;
begin
 if u is null then raise exception 'Não autenticado.' using errcode='FW401';end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(u::text,601607));
 select resumo into anterior from public.reversoes_importacao where user_id=u and tipo=p_tipo and lote_id=p_id;
 if found then return anterior||jsonb_build_object('repetida',true);end if;
 -- Validação de titularidade antes de qualquer trava de outra linha.
 previa:=public.consultar_reversao_importacao(p_tipo,p_id);
 if p_tipo='FATURA' then
  select cartao_id into cartao from public.lotes_fatura where id=p_id and user_id=u for update;
  perform id from public.cartoes_credito where id=cartao and user_id=u for update;
  perform id from public.faturas where cartao_id=cartao and user_id=u order by id for update;
  perform id from public.planos_parcelamento where lote_criador_id=p_id and user_id=u order by id for update;
  select array_agg(transacao_id) into ids from public.cobrancas_importadas where lote_id=p_id and user_id=u;
 else
  perform id from public.importacoes where id=p_id and user_id=u for update;
  select array_agg(id) into ids from public.transacoes_origem where importacao_id=p_id and user_id=u;
 end if;
 perform id from public.transacoes_origem where id=any(ids) and user_id=u order by id for update;
 perform id from public.parcelas where transacao_id=any(ids) and user_id=u order by id for update;
 previa:=public.consultar_reversao_importacao(p_tipo,p_id);
 if not(previa->>'permitido')::boolean then raise exception '%',previa->>'motivo' using errcode='FW409';end if;
 if p_token is null or p_token is distinct from previa->>'token' then raise exception 'O lote mudou desde a prévia. Confira novamente.' using errcode='FW409';end if;
 update public.transacoes_origem set deleted_at=now() where id=any(ids) and user_id=u;
 if p_tipo='FATURA' then
  delete from public.cobrancas_importadas where lote_id=p_id and user_id=u;
  delete from public.planos_parcelamento p where p.lote_criador_id=p_id and p.user_id=u
   and not exists(select 1 from public.cobrancas_importadas c where c.plano_id=p.id);
  update public.lotes_fatura set desfeita_em=now() where id=p_id and user_id=u;
 else
  update public.importacao_linhas set deleted_at=now() where importacao_id=p_id and user_id=u;
  update public.importacoes set deleted_at=now() where id=p_id and user_id=u;
 end if;
 insert into public.reversoes_importacao(user_id,tipo,lote_id,resumo) values(u,p_tipo,p_id,previa);
 return previa||jsonb_build_object('desfeita',true,'repetida',false);
end $$;
revoke all on function public.consultar_reversao_importacao(text,uuid) from public,anon;
revoke all on function public.desfazer_importacao(text,uuid,text) from public,anon;
grant execute on function public.consultar_reversao_importacao(text,uuid) to authenticated;
grant execute on function public.desfazer_importacao(text,uuid,text) to authenticated;

-- Contratos existentes preservados; registro da procedência no momento da confirmação.
create or replace function public.confirmar_fatura_importada(
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
   if lote.desfeita_em is not null then raise exception 'Lote desfeito. Reimporte usando uma nova revisão.' using errcode='FW409'; end if;
   if lote.user_id<>u or lote.conteudo_hash<>hash then raise exception 'Chave já usada por outro conteúdo.' using errcode='FW409'; end if;
   return lote.resultado||jsonb_build_object('repetida',true);
 end if;
 select * into lote from public.lotes_fatura where user_id=u and cartao_id=p_cartao_id
   and competencia=p_competencia and arquivo_sha256=p_sha and desfeita_em is null;
 if found then return lote.resultado||jsonb_build_object('repetida',true); end if;
 select * into c from public.cartoes_credito where id=p_cartao_id and user_id=u and deleted_at is null for update;
 if not found then raise exception 'Cartão não encontrado.' using errcode='FW404'; end if;
 -- Validar todas as linhas antes de gravar; a função é uma transação única.
 for linha in select value from jsonb_array_elements(p_linhas) loop
   if coalesce((linha->>'ignorar')::boolean,false) then continue; end if;
   tipo:=linha->>'tipo';
   if linha ? 'data_confirmada' and (jsonb_typeof(linha->'data_confirmada')<>'boolean' or not coalesce((linha->>'data_confirmada')::boolean,false)) then
     raise exception 'Confirme as datas sugeridas antes de importar.' using errcode='FW400';
   end if;
   if linha ? 'valor_previsto' then
     if jsonb_typeof(linha->'valor_previsto')<>'number' or coalesce(linha->>'valor_previsto','') !~ '^[0-9]{1,12}$' then
       raise exception 'Valor previsto deve ser inteiro em centavos.' using errcode='FW400';
     end if;
     if (linha->>'valor_previsto')::bigint not between 1 and 999999999999 then
       raise exception 'Valor previsto inválido.' using errcode='FW400';
     end if;
   end if;
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
 if p_total is not null and p_total<>total and (p_origem='PDF' or not coalesce(p_conferido,false)) then raise exception 'Total diferente da fatura. Revise e reconheça a diferença.' using errcode='FW400'; end if;
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
       insert into public.planos_parcelamento(user_id,cartao_id,descricao,competencia_base,parcela_base,parcelas_total,valor_previsto,lote_criador_id)
       values(u,p_cartao_id,descricao,p_competencia,numero,quantidade,coalesce((linha->>'valor_previsto')::bigint,v),p_chave) returning id into pid;
     end if;
     if linha ? 'valor_previsto' then
       update public.planos_parcelamento set valor_previsto=(linha->>'valor_previsto')::bigint where id=pid and user_id=u;
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



create or replace function public.confirmar_importacao(p_importacao_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_user_id uuid := auth.uid();
  v_imp public.importacoes%rowtype;
  v_criadas int;
  v_liquidacao record;
begin
  if v_user_id is null then
    raise exception 'Não autenticado.' using errcode='FW401', hint='Sessão ausente/expirada. Não retente; reautentique.';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_user_id::text,601607));
  select * into v_imp from public.importacoes
  where id=p_importacao_id and user_id=v_user_id and deleted_at is null for update;
  if not found then
    raise exception 'Importação % não encontrada para este usuário.', p_importacao_id
      using errcode='FW404', hint='Confira o id da importação.';
  end if;
  if v_imp.status <> 'REVISAO' then
    raise exception 'Importação % já está %.', p_importacao_id, v_imp.status
      using errcode='FW409', hint='Commit é único por importação — não retente.';
  end if;

  with alvo as (
    select data, abs(valor) as valor_abs,
      case when valor < 0 then 'DESPESA' else 'RECEITA' end as tipo,
      descricao, categoria_sugerida, id_externo, fingerprint,
      natureza_detectada, fatura_liquidada_id
    from public.importacao_linhas
    where importacao_id=v_imp.id and user_id=v_user_id and deleted_at is null
      and not ignorar and classificacao <> 'DUPLICADO'
  ), novas as (
    insert into public.transacoes_origem
      (user_id,descricao,valor_total,tipo,forma_pagamento,cartao_id,data_compra,
       num_parcelas,categoria_id,id_externo,fingerprint,source,natureza,fatura_liquidada_id,importacao_id)
    select v_user_id,a.descricao,a.valor_abs,a.tipo,'DEBITO',null,a.data,1,
      a.categoria_sugerida,a.id_externo,a.fingerprint,v_imp.origem,
      a.natureza_detectada,a.fatura_liquidada_id,v_imp.id
    from alvo a
    returning id, valor_total, data_compra
  )
  insert into public.parcelas (user_id,transacao_id,fatura_id,numero,valor,data_competencia)
  select v_user_id,n.id,null,1,n.valor_total,n.data_compra from novas n;
  get diagnostics v_criadas = row_count;

  for v_liquidacao in
    select l.fatura_liquidada_id, min(l.data) as data_pagamento
    from public.importacao_linhas l
    join public.faturas f on f.id=l.fatura_liquidada_id and f.user_id=v_user_id
    where l.importacao_id=v_imp.id and l.user_id=v_user_id and l.deleted_at is null
      and not l.ignorar and l.classificacao <> 'DUPLICADO'
      and l.natureza_detectada='LIQUIDACAO_FATURA' and l.fatura_liquidada_id is not null
      and f.status <> 'PAGA'
    group by l.fatura_liquidada_id
  loop
    perform public.processar_pagamento_fatura(
      v_liquidacao.fatura_liquidada_id,
      v_liquidacao.data_pagamento::timestamptz
    );
  end loop;

  update public.importacoes set status='CONFIRMADA',vinculo_reversao=true,transacoes_criadas=v_criadas where id=v_imp.id;
  return jsonb_build_object('importacao_id',v_imp.id,'transacoes_criadas',v_criadas);
exception when unique_violation then
  raise exception 'Importação % colidiu com transação já existente.', p_importacao_id
    using errcode='FW409', hint='Alguma linha já foi gravada por outra importação. Descarte este lote e reimporte para reclassificar.';
end;
$fn$;
revoke execute on function public.confirmar_importacao(uuid) from public, anon;
grant execute on function public.confirmar_importacao(uuid) to authenticated;
