-- Lotes custosos exigem assinatura privada da API, que contabiliza a cota em outra transação.
-- Sem chave no SQL versionado. Configuração exclusiva do servidor após a migração.
begin;
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
create table public.configuracao_rpc_servidor (
 id boolean primary key default true check(id),
 chave text not null check(chave ~ '^[a-f0-9]{64}$')
);
alter table public.configuracao_rpc_servidor enable row level security;
revoke all on public.configuracao_rpc_servidor from public,anon,authenticated;

create function public.configurar_chave_rpc_servidor(p_chave text) returns void
language plpgsql security definer set search_path='' as $$
begin
 if p_chave is null or p_chave !~ '^[a-f0-9]{64}$' then raise exception 'Chave inválida.' using errcode='FW400';end if;
 insert into public.configuracao_rpc_servidor(id,chave) values(true,p_chave)
 on conflict(id) do update set chave=excluded.chave;
end $$;
revoke all on function public.configurar_chave_rpc_servidor(text) from public,anon,authenticated;
grant execute on function public.configurar_chave_rpc_servidor(text) to service_role;

create function public.exigir_api_servidor(p_rpc text) returns void
language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid();h jsonb;t text;s text;k text;esperada text;
begin
 if u is null then raise exception 'Não autenticado.' using errcode='FW401';end if;
 -- Conexões administrativas já controlam o banco; mantém manutenção e testes SQL locais.
 -- session_user continua authenticator no PostgREST, mesmo em SECURITY DEFINER.
 if session_user in ('postgres','supabase_admin') then return;end if;
 h:=coalesce(nullif(current_setting('request.headers',true),''),'{}')::jsonb;
 t:=h->>'x-financeiro-tempo';s:=h->>'x-financeiro-assinatura';
 if t is null or t !~ '^[0-9]{10}$' or s is null or s !~ '^[a-f0-9]{64}$' then
  raise exception 'Utilize a API do aplicativo.' using errcode='FW403';
 end if;
 if abs(extract(epoch from clock_timestamp())-t::bigint)>30 then
  raise exception 'Assinatura expirada.' using errcode='FW403';
 end if;
 select chave into k from public.configuracao_rpc_servidor where id;
 if k is null then raise exception 'Serviço temporariamente indisponível.' using errcode='FW503';end if;
 esperada:=encode(extensions.hmac(convert_to(t||'|'||u::text||'|'||p_rpc,'UTF8'),decode(k,'hex'),'sha256'),'hex');
 if s<>esperada then raise exception 'Utilize a API do aplicativo.' using errcode='FW403';end if;
end $$;
revoke all on function public.exigir_api_servidor(text) from public,anon,authenticated;
grant execute on function public.exigir_api_servidor(text) to authenticated;

CREATE OR REPLACE FUNCTION public.criar_importacao(p_origem text, p_linhas jsonb, p_arquivo_sha256 text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_user_id uuid := auth.uid();
  v_id uuid; v_total int; v_gravadas int; v_novo int; v_dup int; v_amb int; v_liq int;
  v_previa public.importacoes%rowtype;
begin
 perform public.exigir_api_servidor('criar_importacao');
  if v_user_id is null then
    raise exception 'Não autenticado.' using errcode='FW401',
      hint='Sessão ausente/expirada. Não retente; reautentique.';
  end if;
  if p_origem not in ('CSV','OFX','OFC','XLSX','PDF','PLUGGY') then
    raise exception 'origem inválida: %', p_origem using errcode='FW400',
      hint='Use CSV, OFX, OFC, XLSX, PDF ou PLUGGY.';
  end if;
  if p_arquivo_sha256 is not null and p_arquivo_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'arquivo_sha256 fora do formato.' using errcode='FW400',
      hint='Envie sha256 em hex minúsculo de 64 caracteres, ou null.';
  end if;
  if p_linhas is null or jsonb_typeof(p_linhas) <> 'array' then
    raise exception 'p_linhas deve ser um array JSON.' using errcode='FW400',
      hint='Envie [{data, valor, descricao, id_externo?}, ...].';
  end if;
  v_total := jsonb_array_length(p_linhas);
  if v_total < 1 or v_total > 1000 then
    raise exception 'Importação com % linhas (mínimo 1, máximo 1000).', v_total
      using errcode='FW429', hint='Divida o arquivo em lotes de até 1000 linhas.';
  end if;
  if exists (select 1 from jsonb_array_elements(p_linhas) e
             where jsonb_typeof(e->'valor')='number' and (e->>'valor') ~ '[.,]') then
    raise exception 'Campo valor deve ser inteiro em centavos.' using errcode='FW400',
      hint='Converta reais para centavos na borda (R$ 42,00 -> 4200). Não envie fração.';
  end if;

  if p_arquivo_sha256 is not null then
    select * into v_previa from public.importacoes
    where user_id=v_user_id and arquivo_sha256=p_arquivo_sha256
      and deleted_at is null and status in ('REVISAO','CONFIRMADA')
    order by created_at desc limit 1;
    if found then
      return jsonb_build_object('importacao_id', v_previa.id,
        'arquivo_ja_importado', true, 'status_anterior', v_previa.status,
        'linhas', v_total, 'novos', 0, 'duplicadas', v_total,
        'ambiguos', 0, 'liquidacoes', 0);
    end if;
  end if;

  begin
    insert into public.importacoes (user_id, origem, arquivo_sha256)
    values (v_user_id, p_origem, p_arquivo_sha256) returning id into v_id;
  exception when unique_violation then
    select * into v_previa from public.importacoes
    where user_id=v_user_id and arquivo_sha256=p_arquivo_sha256
      and deleted_at is null and status in ('REVISAO','CONFIRMADA')
    order by created_at desc limit 1;
    return jsonb_build_object('importacao_id', v_previa.id,
      'arquivo_ja_importado', true, 'status_anterior', v_previa.status,
      'linhas', v_total, 'novos', 0, 'duplicadas', v_total,
      'ambiguos', 0, 'liquidacoes', 0);
  end;

  with validas as (
    select l.ord, l.data, l.valor, trim(l.descricao) as descricao,
           nullif(trim(coalesce(l.id_externo,'')),'') as id_externo
    from rows from (jsonb_to_recordset(p_linhas)
           as (data date, valor bigint, descricao text, id_externo text)
         ) with ordinality as l(data, valor, descricao, id_externo, ord)
    where l.data is not null and l.valor is not null and l.valor <> 0
      and coalesce(trim(l.descricao),'') <> ''
      and l.data between date '2000-01-01'
          and (now() at time zone 'America/Sao_Paulo')::date + 1
  ),
  ordenadas as (
    select v.*,
      row_number() over (partition by v.data, v.valor,
        public.fn_normalizar_descricao(v.descricao) order by v.ord)::int as ocorrencia,
      case when v.id_externo is null then 1
           else row_number() over (partition by v.id_externo order by v.ord)::int end as ocorrencia_id_ext
    from validas v
  ),
  comfp as (
    select o.*, public.fn_fingerprint_transacao(o.data, o.valor, o.descricao, o.ocorrencia) as fp
    from ordenadas o
  ),
  classificadas as (
    select c.*,
      case
        when c.ocorrencia_id_ext > 1 then 'DUPLICADO'
        when c.id_externo is not null and exists (
          select 1 from public.transacoes_origem t
          where t.user_id=v_user_id and t.deleted_at is null and t.id_externo=c.id_externo) then 'DUPLICADO'
        when c.id_externo is not null and exists (
          select 1 from public.importacao_linhas il
          join public.importacoes i on i.id = il.importacao_id
          where i.user_id=v_user_id and i.status='REVISAO'
            and i.deleted_at is null and il.deleted_at is null
            and i.id <> v_id and il.id_externo = c.id_externo) then 'DUPLICADO'
        when exists (
          select 1 from public.transacoes_origem t
          where t.user_id=v_user_id and t.deleted_at is null and t.fingerprint=c.fp) then 'DUPLICADO'
        when exists (
          select 1 from public.importacao_linhas il
          join public.importacoes i on i.id = il.importacao_id
          where i.user_id=v_user_id and i.status='REVISAO'
            and i.deleted_at is null and il.deleted_at is null
            and i.id <> v_id and il.fingerprint = c.fp) then 'DUPLICADO'
        when exists (
          select 1 from public.transacoes_origem t
          where t.user_id=v_user_id and t.deleted_at is null
            and t.data_compra=c.data and t.valor_total=abs(c.valor)
            and t.tipo = case when c.valor < 0 then 'DESPESA' else 'RECEITA' end) then 'AMBIGUO'
        else 'NOVO'
      end as classificacao,
      -- Eixo ORTOGONAL ao de dedup.
      public.fn_parece_pagamento_fatura(c.descricao) as parece_liq,
      case when public.fn_parece_pagamento_fatura(c.descricao)
           then public.fn_fatura_liquidada_por(v_user_id, c.data, c.valor) end as fatura_id
    from comfp c
  )
  insert into public.importacao_linhas
    (importacao_id, user_id, data, valor, descricao, categoria_sugerida,
     id_externo, fingerprint, classificacao, duplicada, ignorar,
     natureza_detectada, fatura_liquidada_id, liquidacao_sugerida)
  select v_id, v_user_id, k.data, k.valor, k.descricao,
    -- Liquidação não recebe categoria: não é gasto de categoria nenhuma.
    case when k.valor < 0 and k.fatura_id is null
         then public.fn_sugerir_categoria(v_user_id, k.descricao) end,
    k.id_externo, k.fp, k.classificacao,
    k.classificacao='DUPLICADO', k.classificacao <> 'NOVO',
    case when k.fatura_id is not null then 'LIQUIDACAO_FATURA' else 'CONSUMO' end,
    k.fatura_id,
    -- Sugerida = texto casou mas NENHUMA fatura bateu por valor exato.
    (k.parece_liq and k.fatura_id is null)
  from classificadas k;

  get diagnostics v_gravadas = row_count;
  if v_gravadas <> v_total then
    raise exception 'Lote rejeitado: % de % linhas válidas.', v_gravadas, v_total
      using errcode='FW400',
      hint='Toda linha precisa de data plausível (2000-01-01..amanhã), valor <> 0 em centavos e descrição.';
  end if;

  select count(*) filter (where classificacao='NOVO'),
         count(*) filter (where classificacao='DUPLICADO'),
         count(*) filter (where classificacao='AMBIGUO'),
         count(*) filter (where natureza_detectada='LIQUIDACAO_FATURA')
    into v_novo, v_dup, v_amb, v_liq
  from public.importacao_linhas where importacao_id = v_id;

  return jsonb_build_object('importacao_id', v_id, 'arquivo_ja_importado', false,
    'linhas', v_total, 'novos', v_novo, 'duplicadas', v_dup,
    'ambiguos', v_amb, 'liquidacoes', v_liq);
end;
$function$
;
CREATE OR REPLACE FUNCTION public.confirmar_fatura_importada(p_chave uuid, p_sha text, p_cartao_id uuid, p_competencia date, p_origem text, p_linhas jsonb, p_total bigint DEFAULT NULL::bigint, p_conferido boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
 u uuid:=auth.uid(); c public.cartoes_credito%rowtype; lote public.lotes_fatura%rowtype;
 plano public.planos_parcelamento%rowtype; linha jsonb; item record;
 fid uuid; tid uuid; pid uuid; aid uuid; v bigint; total bigint:=0; criadas int:=0; duplicadas int:=0;
 numero int; quantidade int; ordinal int; fp text; ext text; descricao text; tipo text; d date;
 hash text; vencimento date; candidato boolean; assinatura_decisao text;
begin
 perform public.exigir_api_servidor('confirmar_fatura_importada');
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
$function$
;
CREATE OR REPLACE FUNCTION public.confirmar_importacao(p_importacao_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_user_id uuid := auth.uid();
  v_imp public.importacoes%rowtype;
  v_criadas int;
  v_liquidacao record;
begin
 perform public.exigir_api_servidor('confirmar_importacao');
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
$function$
;
CREATE OR REPLACE FUNCTION public.importar_extrato_conta(p_conta_id uuid, p_origem text, p_linhas jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare u uuid:=auth.uid();a public.contas_bancarias;l jsonb;d date;v bigint;descr text;externo text;k text;lote text;n int:=0;i int:=0;ambiguas int:=0;amb boolean;ant public.linhas_extrato_conta;
begin
 perform public.exigir_api_servidor('importar_extrato_conta');
 if u is null then raise exception 'Não autenticado.' using errcode='FW401';end if;
 select * into a from public.contas_bancarias where id=p_conta_id and user_id=u for update;
 if not found then raise exception 'Conta não encontrada.' using errcode='FW404';end if;
 if p_origem is null or p_origem not in('CSV','OFX','OFC','XLSX','PDF','PLUGGY') or p_linhas is null or jsonb_typeof(p_linhas)<>'array' or jsonb_array_length(p_linhas) not between 1 and 1000 or octet_length(p_linhas::text)>2097152 then raise exception 'Extrato inválido ou acima de 1000 linhas.' using errcode='FW400';end if;
 lote:=md5(p_linhas::text);
 for l in select value from jsonb_array_elements(p_linhas) loop
 i:=i+1;
 if coalesce(l->>'data','')!~'^20[0-9]{2}-[0-9]{2}-[0-9]{2}$' or coalesce(l->>'valor','')!~'^-?[0-9]{1,16}$' then raise exception 'Data ou centavos inválidos.' using errcode='FW400';end if;
 d:=(l->>'data')::date;v:=(l->>'valor')::bigint;descr:=trim(l->>'descricao');externo:=nullif(trim(l->>'id_externo'),'');
 if d<a.data_inicial or v=0 or abs(v)>9007199254740991 or coalesce(length(descr),0) not between 1 and 500 or length(externo)>200 then raise exception 'Linha inválida ou anterior ao saldo inicial.' using errcode='FW400';end if;
 k:=case when externo is not null then 'id:'||case when p_origem='PLUGGY' then 'pluggy:' else 'banco:' end||externo else 'lote:'||lote||':'||i::text end;
 select * into ant from public.linhas_extrato_conta where conta_id=a.id and chave=k;
 if found then
 if ant.data<>d or ant.valor<>v then raise exception 'Movimentação já recebida com outro valor/data. Revise na origem.' using errcode='FW409';end if;
 continue;end if;
 if d<=a.fechado_ate then raise exception 'Nova linha em período fechado. Reabra para conferir.' using errcode='FW409';end if;
 -- Arquivo diferente sem identificador não pode ser deduplicado por heurística.
 amb:=exists(select 1 from public.linhas_extrato_conta where conta_id=a.id and data=d and valor=v and lower(descricao)=lower(descr));
 insert into public.linhas_extrato_conta(user_id,conta_id,chave,origem,data,valor,descricao,id_externo,ambigua) values(u,a.id,k,p_origem,d,v,descr,externo,amb);
 n:=n+1;if amb then ambiguas:=ambiguas+1;end if;
 end loop;
 insert into public.historico_conciliacao(user_id,conta_id,evento,detalhes) values(u,a.id,'EXTRATO_RECEBIDO',jsonb_build_object('novas',n,'ambiguas',ambiguas,'origem',p_origem));
 return jsonb_build_object('novas',n,'repetidas',i-n,'ambiguas',ambiguas);
end $function$
;
CREATE OR REPLACE FUNCTION public.salvar_regra_pessoal(p_chave uuid, p_transacao_id uuid, p_categoria_id uuid, p_padrao text, p_prioridade integer, p_versao text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare u uuid:=auth.uid();ant public.tentativas_regra_pessoal;h text;previa jsonb;regra uuid;resultado jsonb;begin
 perform public.exigir_api_servidor('salvar_regra_pessoal');
 if u is null then raise exception 'Não autenticado.' using errcode='FW401';end if;
 if p_chave is null or p_versao is null then raise exception 'Revise a regra antes de salvar.' using errcode='FW400';end if;
 perform pg_advisory_xact_lock(hashtext('criar_regra_categorizacao:'||u::text));
 h:=md5(jsonb_build_array(p_transacao_id,p_categoria_id,lower(trim(p_padrao)),p_prioridade,p_versao)::text);
 select * into ant from public.tentativas_regra_pessoal where user_id=u and chave=p_chave;
 if found then
  if ant.pedido_hash is distinct from h then raise exception 'Tentativa já usada com outros dados.' using errcode='FW409';end if;
  return ant.resultado;
 end if;
 perform 1 from public.transacoes_origem where id=p_transacao_id and user_id=u and deleted_at is null for update;
 perform 1 from public.categorias where id=p_categoria_id and user_id=u and deleted_at is null for share;
 perform 1 from public.regras_categorizacao where user_id=u and deleted_at is null order by id for share;
 previa:=public.consultar_previa_regra(p_transacao_id,p_categoria_id,p_padrao,p_prioridade);
 if previa->>'versao' is distinct from p_versao then raise exception 'Dados ou regras mudaram. Atualize a prévia antes de confirmar.' using errcode='FW409';end if;
 if previa->>'conflito' is not null then raise exception '%',previa->>'conflito' using errcode='FW409';end if;
 select r.id into regra from public.regras_categorizacao r where r.user_id=u and r.deleted_at is null and lower(trim(r.padrao))=lower(trim(p_padrao)) and r.categoria_id=p_categoria_id and r.prioridade=p_prioridade order by r.created_at,r.id limit 1;
 if regra is null then regra:=(public.criar_regra_categorizacao(trim(p_padrao),p_categoria_id,p_prioridade)->>'regra_id')::uuid;end if;
 perform public.definir_categoria_transacao(p_transacao_id,p_categoria_id,false,null);
 resultado:=jsonb_build_object('regra_id',regra,'transacao_id',p_transacao_id);
 insert into public.tentativas_regra_pessoal values(u,p_chave,h,resultado);
 return resultado;
end $function$
;

commit;
