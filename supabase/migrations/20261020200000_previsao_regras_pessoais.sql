-- Leitura sob as permissões do titular: views security_invoker não podem
-- ser consultadas como dono do banco para calcular caixa de uma conta.
create function public.consultar_eventos_caixa(p_hoje date) returns jsonb language plpgsql security invoker set search_path='' as $$
declare u uuid:=auth.uid();resultado jsonb;caixa bigint;reservado bigint;begin
 if u is null then raise exception 'Não autenticado.' using errcode='FW401';end if;
 if p_hoje is null or p_hoje not between '2000-01-01' and '2099-09-30' then raise exception 'Data inicial inválida.' using errcode='FW400';end if;
 with meses as(select generate_series(date_trunc('month',p_hoje)-interval '1 month',p_hoje+89,interval '1 month')::date mes),
 regras as(select r.*,m.mes,(m.mes+least(r.dia_do_mes-1,extract(day from m.mes+interval '1 month - 1 day')::integer-1))::date dia from public.recorrencias r cross join meses m where r.user_id=u and r.finalidade='LANCAMENTO' and r.deleted_at is null),
 receitas as(
  select 'receita:'||r.id||':'||r.mes as id,coalesce(o.data_prevista,r.dia) as data,coalesce(o.valor,r.valor) as valor,'ENTRADA'::text as tipo,coalesce(o.descricao,r.descricao) as descricao,'PREVISTA'::text as situacao,'/transacoes#receitas-recorrentes'::text as origem
  from regras r left join public.ocorrencias_receita o on o.recorrencia_id=r.id and o.competencia=r.mes and o.user_id=u
  where r.tipo='RECEITA' and r.confirmar_recebimento and r.ativa and r.dia>=r.proxima_data and not(r.dia<@r.pausas_receita) and coalesce(o.status,'PREVISTA')='PREVISTA'
 ),despesas as(
  select 'recorrencia:'||r.id||':'||r.mes as id,r.dia as data,r.valor,'SAIDA'::text tipo,r.descricao,'ESTIMADA'::text situacao,'/transacoes'::text origem from regras r where r.tipo='DESPESA' and r.ativa and r.dia>=r.proxima_data and r.mes>=date_trunc('month',p_hoje)
 ),atrasos as(
  select 'recorrencia-atraso:'||r.id id,r.proxima_data data,
  (r.valor*((extract(year from p_hoje)::integer-extract(year from r.proxima_data)::integer)*12+extract(month from p_hoje)::integer-extract(month from r.proxima_data)::integer))::bigint valor,
  'SAIDA'::text tipo,'Recorrências em atraso · '||r.descricao descricao,'ESTIMADA'::text situacao,'/transacoes'::text origem
  from public.recorrencias r where r.user_id=u and r.finalidade='LANCAMENTO' and r.tipo='DESPESA' and r.ativa and r.deleted_at is null and r.proxima_data<date_trunc('month',p_hoje)
 ),contas as(
  select c.tipo||':'||c.origem_id as id,c.data_vencimento as data,c.valor,'SAIDA'::text tipo,c.descricao,'REGISTRADA'::text situacao,'/faturas'::text origem from public.vw_contas_a_pagar c where c.data_vencimento<=p_hoje+89
 ),agenda_assinaturas as(
  select r.*,m.mes,(m.mes+least(r.dia_do_mes-1,extract(day from m.mes+interval '1 month - 1 day')::integer-1))::date dia
  from public.recorrencias r cross join meses m where r.user_id=u and r.finalidade='ASSINATURA' and r.status='ATIVA' and r.deleted_at is null
  and ((extract(year from m.mes)::integer-extract(year from r.proxima_data)::integer)*12+extract(month from m.mes)::integer-extract(month from r.proxima_data)::integer)%case r.periodicidade when 'MENSAL' then 1 when 'TRIMESTRAL' then 3 when 'SEMESTRAL' then 6 else 12 end=0
 ),assinaturas as(
  select a.*,case when c.id is not null and extract(day from a.dia)>=least(c.dia_fechamento,extract(day from a.mes+interval '1 month - 1 day')::integer) then (a.mes+interval '1 month')::date else a.mes end competencia
  from agenda_assinaturas a left join public.cartoes_credito c on c.id=a.cartao_id and c.user_id=u and c.deleted_at is null where a.dia>=a.proxima_data
 ),sem_cartao as(
  select 'assinatura:'||a.id||':'||a.mes id,a.dia data,a.valor,'SAIDA'::text tipo,a.descricao,'ESTIMADA'::text situacao,'/assinaturas'::text origem from assinaturas a where a.cartao_id is null and a.dia>=p_hoje
 ),previsoes_cartao as(
  select p.cartao_id,p.competencia,p.valor from public.vw_previsoes_parcelamento p where p.user_id=u and p.competencia between date_trunc('month',p_hoje)-interval '1 month' and p_hoje+89
  union all select a.cartao_id,a.competencia,a.valor from assinaturas a where a.cartao_id is not null and not exists(select 1 from public.vw_cobrancas_assinaturas v where v.user_id=u and v.assinatura_id=a.id and v.competencia=a.competencia)
 ),grupos as(select p.cartao_id,p.competencia,sum(p.valor)::bigint valor from previsoes_cartao p group by p.cartao_id,p.competencia),
 estimativas_cartao as(
  select 'cartao-previsto:'||g.cartao_id||':'||g.competencia id,
   coalesce(f.data_vencimento,(v.mes+least(c.dia_vencimento-1,extract(day from v.mes+interval '1 month - 1 day')::integer-1))::date) data,
   g.valor,'SAIDA'::text tipo,'Complemento previsto da fatura · '||c.nome descricao,'ESTIMADA'::text situacao,'/planejamento'::text origem
  from grupos g join public.cartoes_credito c on c.id=g.cartao_id and c.user_id=u and c.deleted_at is null
  left join public.faturas f on f.cartao_id=c.id and f.user_id=u and f.competencia=g.competencia and f.deleted_at is null
  cross join lateral(select (g.competencia+case when c.dia_vencimento<=c.dia_fechamento then interval '1 month' else interval '0 month' end)::date mes)v
  where f.id is null or f.status<>'PAGA'
 ),eventos as(select * from receitas union all select * from despesas union all select * from atrasos union all select * from contas union all select * from sem_cartao union all select * from estimativas_cartao)
 -- Um único SELECT: caixa, reservas e eventos observam o mesmo snapshot.
 select coalesce(jsonb_agg(to_jsonb(e) order by data,id),'[]'::jsonb),
  (select saldo_caixa from public.vw_carteira),
  (select coalesce(sum(saldo_atual),0)::bigint from public.cofrinhos where user_id=u and deleted_at is null)
 into resultado,caixa,reservado from(select * from eventos where data<=p_hoje+89 and (id not like 'cartao-previsto:%' or data>=p_hoje) order by data,id limit 10001)e;
 if jsonb_array_length(resultado)>10000 then raise exception 'Mais de 10 mil eventos na previsão; revise o volume de regras e compromissos.' using errcode='FW429';end if;
 return jsonb_build_object('eventos',resultado,'caixa',caixa,'reservado',reservado);
end $$;
revoke all on function public.consultar_eventos_caixa(date) from public,anon,authenticated;
grant execute on function public.consultar_eventos_caixa(date) to authenticated;

create table public.tentativas_regra_pessoal(user_id uuid not null references auth.users(id) on delete cascade,chave uuid not null,pedido_hash text not null,resultado jsonb not null,primary key(user_id,chave));
alter table public.tentativas_regra_pessoal enable row level security;
create policy tentativas_regra_select on public.tentativas_regra_pessoal for select using((select auth.uid())=user_id);
revoke all on public.tentativas_regra_pessoal from public,anon,authenticated;
grant select on public.tentativas_regra_pessoal to authenticated;

create function public.consultar_previa_regra(p_transacao_id uuid,p_categoria_id uuid,p_padrao text,p_prioridade integer) returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid();t public.transacoes_origem;c public.categorias;versao text;exemplos jsonb;total bigint;conflito text;vencedora uuid;begin
 if u is null then raise exception 'Não autenticado.' using errcode='FW401';end if;
 if coalesce(length(trim(p_padrao)),0) not between 3 and 200 or p_prioridade is null or p_prioridade not between 0 and 100000 then raise exception 'Informe padrão de 3 a 200 caracteres e prioridade válida.' using errcode='FW400';end if;
 select * into t from public.transacoes_origem where id=p_transacao_id and user_id=u and deleted_at is null;
 if not found then raise exception 'Lançamento não encontrado.' using errcode='FW404';end if;
 select * into c from public.categorias where id=p_categoria_id and user_id=u and tipo=t.tipo and deleted_at is null;
 if not found then raise exception 'Categoria incompatível.' using errcode='FW404';end if;
 if t.natureza='LIQUIDACAO_FATURA' or public.fn_parece_pagamento_fatura(t.descricao) then raise exception 'Liquidação de fatura não gera regra de consumo.' using errcode='FW409';end if;
 if position(lower(trim(p_padrao)) in lower(t.descricao))=0 then raise exception 'O padrão precisa corresponder à descrição corrigida.' using errcode='FW400';end if;
 select md5(jsonb_build_array(to_jsonb(t),to_jsonb(c),lower(trim(p_padrao)),p_prioridade,
  coalesce((select jsonb_agg(to_jsonb(r) order by r.id) from public.regras_categorizacao r where r.user_id=u and r.deleted_at is null),'[]'::jsonb))::text) into versao;
 select count(*) into total from public.transacoes_origem x where x.user_id=u and x.deleted_at is null and x.tipo=t.tipo and x.natureza='CONSUMO' and position(lower(trim(p_padrao)) in lower(x.descricao))>0;
 select coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) into exemplos from(select id,descricao,categoria_id from public.transacoes_origem where user_id=u and deleted_at is null and tipo=t.tipo and natureza='CONSUMO' and position(lower(trim(p_padrao)) in lower(descricao))>0 order by id limit 20)x;
 if exists(select 1 from public.regras_categorizacao r join public.categorias cr on cr.id=r.categoria_id and cr.deleted_at is null where r.user_id=u and r.deleted_at is null and cr.tipo=t.tipo and lower(trim(r.padrao))=lower(trim(p_padrao)) and r.categoria_id<>p_categoria_id) then conflito:='Já existe regra com este padrão e outra categoria. Confira em Categorias antes de substituir.';end if;
 if exists(select 1 from public.regras_categorizacao r where r.user_id=u and r.deleted_at is null and lower(trim(r.padrao))=lower(trim(p_padrao)) and r.categoria_id=p_categoria_id and r.prioridade<>p_prioridade) then conflito:=coalesce(conflito,'Já existe este padrão e categoria com outra prioridade. Confira suas regras em Categorias antes de substituir.');end if;
 select r.categoria_id into vencedora from public.regras_categorizacao r join public.categorias cr on cr.id=r.categoria_id and cr.deleted_at is null and cr.tipo=t.tipo where r.user_id=u and r.deleted_at is null and r.prioridade<=p_prioridade and position(lower(r.padrao) in lower(t.descricao))>0 order by r.prioridade,r.created_at,r.id limit 1;
 if vencedora is not null and vencedora<>p_categoria_id then conflito:=coalesce(conflito,'Outra regra tem precedência nesta descrição. Ajuste o padrão/prioridade ou confira suas regras em Categorias.');end if;
 return jsonb_build_object('versao',versao,'tipo',t.tipo,'total',total,'exemplos',exemplos,'amplo',length(trim(p_padrao))<5,'conflito',conflito);
end $$;
revoke all on function public.consultar_previa_regra(uuid,uuid,text,integer) from public,anon,authenticated;
grant execute on function public.consultar_previa_regra(uuid,uuid,text,integer) to authenticated;

create function public.salvar_regra_pessoal(p_chave uuid,p_transacao_id uuid,p_categoria_id uuid,p_padrao text,p_prioridade integer,p_versao text) returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid();ant public.tentativas_regra_pessoal;h text;previa jsonb;regra uuid;resultado jsonb;begin
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
end $$;
revoke all on function public.salvar_regra_pessoal(uuid,uuid,uuid,text,integer,text) from public,anon,authenticated;
grant execute on function public.salvar_regra_pessoal(uuid,uuid,uuid,text,integer,text) to authenticated;

-- Importadores antigos consultam esta função só para saídas. O trigger
-- tipado abaixo cobre também entradas, sem misturar renda e consumo.
create or replace function public.fn_sugerir_categoria(p_user_id uuid,p_descricao text) returns uuid language sql stable security definer set search_path='' as $$
 select r.categoria_id from public.regras_categorizacao r join public.categorias c on c.id=r.categoria_id and c.deleted_at is null and c.tipo='DESPESA'
 where r.user_id=p_user_id and r.deleted_at is null and position(lower(r.padrao) in lower(p_descricao))>0 order by r.prioridade,r.created_at,r.id limit 1;
$$;
revoke all on function public.fn_sugerir_categoria(uuid,text) from public,anon,authenticated;
create or replace function public.fn_autocategorizar_transacao() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.categoria_id is null and new.natureza<>'LIQUIDACAO_FATURA' and not public.fn_parece_pagamento_fatura(new.descricao) then
  select r.categoria_id into new.categoria_id from public.regras_categorizacao r join public.categorias c on c.id=r.categoria_id and c.user_id=new.user_id and c.tipo=new.tipo and c.deleted_at is null
  where r.user_id=new.user_id and r.deleted_at is null and position(lower(r.padrao) in lower(new.descricao))>0 order by r.prioridade,r.created_at,r.id limit 1;
 end if;return new;
end $$;
revoke all on function public.fn_autocategorizar_transacao() from public,anon,authenticated;
