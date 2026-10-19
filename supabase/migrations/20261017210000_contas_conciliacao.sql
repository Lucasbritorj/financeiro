-- Razão bancário separado do consumo; todas as escritas passam por RPC.
create table public.contas_bancarias (
 id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id) on delete cascade,
 nome text not null check(length(trim(nome)) between 1 and 100),saldo_inicial bigint not null check(abs(saldo_inicial)<=9007199254740991),
 data_inicial date not null check(data_inicial between '2000-01-01' and '2099-12-31'),
 fechado_ate date,saldo_fechado bigint,created_at timestamptz not null default now()
);
create index contas_titular on public.contas_bancarias(user_id,id);
create table public.movimentos_conta (
 id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id) on delete cascade,
 conta_id uuid not null references public.contas_bancarias(id),data date not null,valor bigint not null check(valor<>0 and abs(valor)<=9007199254740991),
 descricao text not null,transacao_id uuid unique references public.transacoes_origem(id),transferencia_id uuid,fatura_id uuid unique references public.faturas(id),
 created_at timestamptz not null default now(),check((transferencia_id is null and (transacao_id is not null or fatura_id is not null)) or (transferencia_id is not null and transacao_id is null and fatura_id is null)),unique(conta_id,transferencia_id)
);
create index movimentos_conta_periodo on public.movimentos_conta(user_id,conta_id,data,id);
create table public.linhas_extrato_conta (
 id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id) on delete cascade,
 conta_id uuid not null references public.contas_bancarias(id),chave text not null,origem text not null,
 data date not null,valor bigint not null check(valor<>0 and abs(valor)<=9007199254740991),descricao text not null,
 id_externo text,movimento_id uuid unique references public.movimentos_conta(id),ignorada boolean not null default false,
 ambigua boolean not null default false,created_at timestamptz not null default now(),unique(conta_id,chave)
);
create index extrato_conta_periodo on public.linhas_extrato_conta(user_id,conta_id,data,id);
create table public.historico_conciliacao (
 id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id) on delete cascade,
 conta_id uuid not null references public.contas_bancarias(id),evento text not null,detalhes jsonb not null,created_at timestamptz not null default clock_timestamp()
);
create index historico_conta on public.historico_conciliacao(user_id,conta_id,created_at);
alter table public.contas_bancarias enable row level security;
create policy titular_select on public.contas_bancarias for select using(user_id=(select auth.uid()));
revoke all on public.contas_bancarias from public,anon,authenticated;
grant select on public.contas_bancarias to authenticated;
alter table public.movimentos_conta enable row level security;
create policy titular_select on public.movimentos_conta for select using(user_id=(select auth.uid()));
revoke all on public.movimentos_conta from public,anon,authenticated;
grant select on public.movimentos_conta to authenticated;
alter table public.linhas_extrato_conta enable row level security;
create policy titular_select on public.linhas_extrato_conta for select using(user_id=(select auth.uid()));
revoke all on public.linhas_extrato_conta from public,anon,authenticated;
grant select on public.linhas_extrato_conta to authenticated;
alter table public.historico_conciliacao enable row level security;
create policy titular_select on public.historico_conciliacao for select using(user_id=(select auth.uid()));
revoke all on public.historico_conciliacao from public,anon,authenticated;
grant select on public.historico_conciliacao to authenticated;

create function public.criar_conta_bancaria(p_nome text,p_saldo_inicial bigint,p_data_inicial date)
returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid();i uuid;begin
 if u is null then raise exception 'Não autenticado.' using errcode='FW401';end if;
 if coalesce(length(trim(p_nome)),0) not between 1 and 100 or p_saldo_inicial is null or abs(p_saldo_inicial)>9007199254740991 or p_data_inicial is null or p_data_inicial not between '2000-01-01' and '2099-12-31' then raise exception 'Nome, saldo ou data inválidos.' using errcode='FW400';end if;
 insert into public.contas_bancarias(user_id,nome,saldo_inicial,data_inicial) values(u,trim(p_nome),p_saldo_inicial,p_data_inicial) returning id into i;
 insert into public.historico_conciliacao(user_id,conta_id,evento,detalhes) values(u,i,'CONTA_CRIADA',jsonb_build_object('saldo',p_saldo_inicial,'data',p_data_inicial));
 return jsonb_build_object('id',i);
end $$;

create function public.transferir_entre_contas(p_origem uuid,p_destino uuid,p_valor bigint,p_data date,p_chave uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid();a public.contas_bancarias;b public.contas_bancarias;begin
 if u is null then raise exception 'Não autenticado.' using errcode='FW401';end if;
 if p_origem is null or p_destino is null or p_origem=p_destino or p_chave is null or p_valor is null or p_valor not between 1 and 9007199254740991 or p_data is null then raise exception 'Transferência inválida.' using errcode='FW400';end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(u::text||p_chave::text,0));
 -- Ordem estável para que transferências opostas concorrentes não causem deadlock.
 perform 1 from public.contas_bancarias where id in(p_origem,p_destino) and user_id=u order by id for update;
 select * into a from public.contas_bancarias where id=p_origem and user_id=u;
 select * into b from public.contas_bancarias where id=p_destino and user_id=u;
 if a.id is null or b.id is null then raise exception 'Conta não encontrada.' using errcode='FW404';end if;
 if exists(select 1 from public.movimentos_conta where user_id=u and transferencia_id=p_chave) then
 if (select count(*) from public.movimentos_conta where user_id=u and transferencia_id=p_chave and data=p_data and ((conta_id=a.id and valor=-p_valor) or (conta_id=b.id and valor=p_valor)))<>2 then raise exception 'Chave já usada em outra transferência.' using errcode='FW409';end if;
 return jsonb_build_object('id',p_chave,'repetida',true);end if;
 if p_data<a.data_inicial or p_data<b.data_inicial or p_data>'2099-12-31' then raise exception 'Data anterior ao saldo inicial ou fora do limite.' using errcode='FW400';end if;
 if p_data<=a.fechado_ate or p_data<=b.fechado_ate then raise exception 'Período fechado. Reabra antes de alterar.' using errcode='FW409';end if;
 insert into public.movimentos_conta(user_id,conta_id,data,valor,descricao,transferencia_id) values(u,a.id,p_data,-p_valor,'Transferência para '||b.nome,p_chave),(u,b.id,p_data,p_valor,'Transferência de '||a.nome,p_chave);
 insert into public.historico_conciliacao(user_id,conta_id,evento,detalhes) values(u,a.id,'TRANSFERENCIA',jsonb_build_object('id',p_chave,'destino',b.id,'valor',p_valor)),(u,b.id,'TRANSFERENCIA',jsonb_build_object('id',p_chave,'origem',a.id,'valor',p_valor));
 return jsonb_build_object('id',p_chave,'repetida',false);
end $$;

create function public.importar_extrato_conta(p_conta_id uuid,p_origem text,p_linhas jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid();a public.contas_bancarias;l jsonb;d date;v bigint;descr text;externo text;k text;lote text;n int:=0;i int:=0;ambiguas int:=0;amb boolean;ant public.linhas_extrato_conta;
begin
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
end $$;

create function public.conciliar_linha_conta(p_linha_id uuid,p_acao text,p_transacao_id uuid default null,p_movimento_id uuid default null,p_categoria_id uuid default null,p_fatura_id uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid();l public.linhas_extrato_conta;a public.contas_bancarias;t public.transacoes_origem;m public.movimentos_conta;tid uuid;mid uuid;f public.faturas;v bigint;data_efetiva date;
begin
 if u is null then raise exception 'Não autenticado.' using errcode='FW401';end if;
 select * into l from public.linhas_extrato_conta where id=p_linha_id and user_id=u;
 if not found then raise exception 'Linha não encontrada.' using errcode='FW404';end if;
 select * into a from public.contas_bancarias where id=l.conta_id and user_id=u for update;
 select * into l from public.linhas_extrato_conta where id=p_linha_id and user_id=u for update;
 if l.movimento_id is not null then
 select * into m from public.movimentos_conta where id=l.movimento_id;
 if (p_acao='VINCULAR' and m.transacao_id=p_transacao_id) or (p_acao='TRANSFERENCIA' and m.id=p_movimento_id) or (p_acao='FATURA' and m.fatura_id=p_fatura_id) then return jsonb_build_object('movimento_id',m.id,'repetida',true);end if;
 raise exception 'Linha já conciliada.' using errcode='FW409';end if;
 if l.data<=a.fechado_ate then raise exception 'Período fechado.' using errcode='FW409';end if;
 if l.ignorada then raise exception 'Desfaça a exclusão da revisão primeiro.' using errcode='FW409';end if;
 if p_acao='IGNORAR' then
 update public.linhas_extrato_conta set ignorada=true where id=l.id;
 elsif p_acao='TRANSFERENCIA' then
 select * into m from public.movimentos_conta where id=p_movimento_id and user_id=u and conta_id=a.id and transferencia_id is not null for update;
 if not found or m.valor<>l.valor or abs(m.data-l.data)>3 then raise exception 'Transferência incompatível.' using errcode='FW400';end if;
 mid:=m.id;
 elsif p_acao='FATURA' then
 select * into f from public.faturas where id=p_fatura_id and user_id=u and deleted_at is null for update;
 if not found or f.status<>'PAGA' then raise exception 'Registre primeiro a quitação da fatura em Contas a pagar.' using errcode='FW409';end if;
 select sum(valor),(max(data_pagamento) at time zone 'America/Sao_Paulo')::date into v,data_efetiva from public.parcelas where fatura_id=f.id and user_id=u and deleted_at is null and status='PAGA';
 if v is null or data_efetiva is null or l.valor<>-v or abs(data_efetiva-l.data)>3 then raise exception 'Fatura incompatível com valor ou data do pagamento bancário.' using errcode='FW400';end if;
 if exists(select 1 from public.movimentos_conta where fatura_id=f.id) then raise exception 'Quitação já vinculada a uma conta.' using errcode='FW409';end if;
 insert into public.movimentos_conta(user_id,conta_id,data,valor,descricao,fatura_id) values(u,a.id,l.data,l.valor,'Quitação de fatura '||f.competencia::text,f.id) returning id into mid;
 elsif p_acao in('VINCULAR','NOVA') then
 if p_acao='NOVA' then
 if public.fn_parece_pagamento_fatura(l.descricao) then raise exception 'Pagamento de fatura: vincule à quitação já registrada em Contas a pagar.' using errcode='FW409';end if;
 tid:=(public.processar_transacao_completa(l.descricao,abs(l.valor),case when l.valor<0 then 'DESPESA' else 'RECEITA' end,'DEBITO',null,l.data,1)->>'transacao_id')::uuid;
 if p_categoria_id is not null then
 perform 1 from public.categorias where id=p_categoria_id and user_id=u and deleted_at is null and tipo=case when l.valor<0 then 'DESPESA' else 'RECEITA' end;
 if not found then raise exception 'Categoria incompatível.' using errcode='FW400';end if;
 update public.transacoes_origem set categoria_id=p_categoria_id where id=tid;end if;
 else tid:=p_transacao_id;end if;
 select * into t from public.transacoes_origem where id=tid and user_id=u and deleted_at is null for update;
 if not found then raise exception 'Lançamento não encontrado.' using errcode='FW404';end if;
 data_efetiva:=t.data_compra;
 if t.forma_pagamento='BOLETO' then
 select (p.data_pagamento at time zone 'America/Sao_Paulo')::date into data_efetiva from public.parcelas p where p.transacao_id=t.id and p.user_id=u and p.status='PAGA' and p.deleted_at is null for update;
 if data_efetiva is null then raise exception 'Quite o boleto em Contas a pagar antes de conciliar.' using errcode='FW409';end if;
 end if;
 if t.forma_pagamento not in('PIX','DEBITO','DINHEIRO','BOLETO') or t.valor_total<>abs(l.valor) or t.tipo<>(case when l.valor<0 then 'DESPESA' else 'RECEITA' end) or abs(data_efetiva-l.data)>3 then raise exception 'Lançamento incompatível com valor, sinal ou data do banco.' using errcode='FW400';end if;
 if exists(select 1 from public.movimentos_conta where transacao_id=t.id) then raise exception 'Lançamento já vinculado a uma conta.' using errcode='FW409';end if;
 insert into public.movimentos_conta(user_id,conta_id,data,valor,descricao,transacao_id,fatura_id) values(u,a.id,l.data,l.valor,t.descricao,t.id,t.fatura_liquidada_id) returning id into mid;
 else raise exception 'Ação inválida.' using errcode='FW400';end if;
 if mid is not null then update public.linhas_extrato_conta set movimento_id=mid where id=l.id;end if;
 insert into public.historico_conciliacao(user_id,conta_id,evento,detalhes) values(u,a.id,p_acao,jsonb_build_object('linha_id',l.id,'movimento_id',mid));
 return jsonb_build_object('movimento_id',mid,'repetida',false);
end $$;

create function public.desfazer_conciliacao_conta(p_linha_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid();l public.linhas_extrato_conta;a public.contas_bancarias;begin
 if u is null then raise exception 'Não autenticado.' using errcode='FW401';end if;
 select * into l from public.linhas_extrato_conta where id=p_linha_id and user_id=u;
 if not found then raise exception 'Linha não encontrada.' using errcode='FW404';end if;
 select * into a from public.contas_bancarias where id=l.conta_id and user_id=u for update;
 select * into l from public.linhas_extrato_conta where id=p_linha_id and user_id=u for update;
 if l.data<=a.fechado_ate or exists(select 1 from public.movimentos_conta where id=l.movimento_id and data<=a.fechado_ate) then raise exception 'Reabra o período antes de desfazer.' using errcode='FW409';end if;
 update public.linhas_extrato_conta set movimento_id=null,ignorada=false where id=l.id;
 -- Preserva o lançamento de consumo; solta somente sua atribuição à conta.
 delete from public.movimentos_conta where id=l.movimento_id and transferencia_id is null;
 insert into public.historico_conciliacao(user_id,conta_id,evento,detalhes) values(u,a.id,'DESFEITA',jsonb_build_object('linha_id',l.id,'movimento_id',l.movimento_id));
 return jsonb_build_object('desfeita',true);
end $$;

create function public.fechar_conciliacao_conta(p_conta_id uuid,p_ate date,p_saldo_informado bigint)
returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid();a public.contas_bancarias;saldo numeric;begin
 if u is null then raise exception 'Não autenticado.' using errcode='FW401';end if;
 select * into a from public.contas_bancarias where id=p_conta_id and user_id=u for update;
 if not found then raise exception 'Conta não encontrada.' using errcode='FW404';end if;
 if p_ate is null or p_ate<a.data_inicial or p_ate>'2099-12-31' or p_ate<a.fechado_ate or p_saldo_informado is null or abs(p_saldo_informado)>9007199254740991 then raise exception 'Data ou saldo inválido.' using errcode='FW400';end if;
 select a.saldo_inicial+coalesce(sum(valor),0) into saldo from public.movimentos_conta where conta_id=a.id and user_id=u and data<=p_ate;
 if abs(saldo)>9007199254740991 then raise exception 'Saldo acima do limite de precisão.' using errcode='FW409';end if;
 if saldo<>p_saldo_informado then raise exception 'Saldo divergente. Confira os movimentos antes de fechar.' using errcode='FW409';end if;
 if exists(select 1 from public.linhas_extrato_conta where conta_id=a.id and user_id=u and data<=p_ate and movimento_id is null and not ignorada) or exists(select 1 from public.movimentos_conta m where m.conta_id=a.id and m.user_id=u and m.data<=p_ate and not exists(select 1 from public.linhas_extrato_conta l where l.movimento_id=m.id and l.data<=p_ate)) then raise exception 'Há linhas ou movimentos sem conciliação dentro da data de fechamento.' using errcode='FW409';end if;
 update public.contas_bancarias set fechado_ate=p_ate,saldo_fechado=p_saldo_informado where id=a.id;
 insert into public.historico_conciliacao(user_id,conta_id,evento,detalhes) values(u,a.id,'FECHAMENTO',jsonb_build_object('ate',p_ate,'saldo',saldo));
 return jsonb_build_object('saldo',saldo,'fechado',true);
end $$;

create function public.reabrir_conciliacao_conta(p_conta_id uuid,p_motivo text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid();a public.contas_bancarias;begin
 if u is null then raise exception 'Não autenticado.' using errcode='FW401';end if;
 if coalesce(length(trim(p_motivo)),0) not between 5 and 500 then raise exception 'Informe o motivo da reabertura (5 a 500 caracteres).' using errcode='FW400';end if;
 select * into a from public.contas_bancarias where id=p_conta_id and user_id=u for update;
 if not found then raise exception 'Conta não encontrada.' using errcode='FW404';end if;
 update public.contas_bancarias set fechado_ate=null,saldo_fechado=null where id=a.id;
 insert into public.historico_conciliacao(user_id,conta_id,evento,detalhes) values(u,a.id,'REABERTURA',jsonb_build_object('motivo',trim(p_motivo),'fechado_ate_anterior',a.fechado_ate,'saldo_anterior',a.saldo_fechado));
 return jsonb_build_object('reaberta',true);
end $$;

create function public.consultar_conta_bancaria(p_conta_id uuid,p_de date,p_ate date)
returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid();a public.contas_bancarias;saldo numeric;linhas jsonb;movs jsonb;candidatos jsonb;historico jsonb;faturas jsonb;begin
 if u is null then raise exception 'Não autenticado.' using errcode='FW401';end if;
 select * into a from public.contas_bancarias where id=p_conta_id and user_id=u;
 if not found then raise exception 'Conta não encontrada.' using errcode='FW404';end if;
 if p_de is null or p_ate is null or p_de>p_ate or p_ate-p_de>366 then raise exception 'Selecione um período de até 366 dias.' using errcode='FW400';end if;
 if (select count(*) from public.linhas_extrato_conta where conta_id=a.id and user_id=u and data between p_de and p_ate)>1000 then raise exception 'Mais de 1000 linhas; selecione um período menor.' using errcode='FW400';end if;
 select a.saldo_inicial+coalesce(sum(valor),0) into saldo from public.movimentos_conta where conta_id=a.id and user_id=u and data<=p_ate;
 if abs(saldo)>9007199254740991 then raise exception 'Saldo acima do limite de precisão.' using errcode='FW409';end if;
 select coalesce(jsonb_agg(to_jsonb(l) order by data,id),'[]') into linhas from public.linhas_extrato_conta l where conta_id=a.id and user_id=u and data between p_de and p_ate;
 select coalesce(jsonb_agg(to_jsonb(m) order by data,id),'[]') into movs from public.movimentos_conta m where conta_id=a.id and user_id=u and data between p_de-3 and p_ate+3;
 select coalesce(jsonb_agg(to_jsonb(t) order by data_compra,id),'[]') into candidatos from (
 select t.id,t.descricao,coalesce((p.data_pagamento at time zone 'America/Sao_Paulo')::date,t.data_compra) as data_compra,t.valor_total,t.tipo,t.natureza from public.transacoes_origem t
 left join public.parcelas p on t.forma_pagamento='BOLETO' and p.transacao_id=t.id and p.user_id=u and p.status='PAGA' and p.deleted_at is null
 where t.user_id=u and t.deleted_at is null and (t.forma_pagamento in('PIX','DEBITO','DINHEIRO') or (t.forma_pagamento='BOLETO' and p.data_pagamento is not null))
 and coalesce((p.data_pagamento at time zone 'America/Sao_Paulo')::date,t.data_compra) between p_de-3 and p_ate+3
 and not exists(select 1 from public.movimentos_conta m where m.transacao_id=t.id or m.fatura_id=t.fatura_liquidada_id) limit 1001) t;
 if jsonb_array_length(candidatos)>1000 then raise exception 'Mais de 1000 lançamentos candidatos; reduza o período.' using errcode='FW400';end if;
 select coalesce(jsonb_agg(to_jsonb(h) order by created_at desc),'[]') into historico from (select evento,detalhes,created_at from public.historico_conciliacao where conta_id=a.id and user_id=u order by created_at desc limit 50) h;
 select coalesce(jsonb_agg(to_jsonb(x)),'[]') into faturas from (
 select f.id,'Fatura '||c.nome||' · '||to_char(f.competencia,'MM/YYYY') as descricao,sum(p.valor) as valor,(max(p.data_pagamento) at time zone 'America/Sao_Paulo')::date as data
 from public.faturas f join public.cartoes_credito c on c.id=f.cartao_id and c.user_id=u
 join public.parcelas p on p.fatura_id=f.id and p.user_id=u and p.status='PAGA' and p.deleted_at is null
 where f.user_id=u and f.status='PAGA' and f.deleted_at is null and not exists(select 1 from public.movimentos_conta m where m.fatura_id=f.id)
 group by f.id,c.nome having (max(p.data_pagamento) at time zone 'America/Sao_Paulo')::date between p_de-3 and p_ate+3 limit 1001) x;
 if jsonb_array_length(faturas)>1000 then raise exception 'Muitas faturas; reduza o período.' using errcode='FW400';end if;
 return jsonb_build_object('conta',to_jsonb(a),'saldo',saldo,'linhas',linhas,'movimentos',movs,'candidatos',candidatos,'faturas',faturas,'historico',historico);
end $$;

-- Bloqueia edição/exclusão por qualquer RPC antiga; desfazer é uma ação explícita.
create function public.fn_proteger_transacao_conciliada() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if exists(select 1 from auth.users where id=old.user_id) and exists(select 1 from public.movimentos_conta where transacao_id=old.id) then raise exception 'Lançamento conciliado: desfaça a conciliação antes de alterar.' using errcode='FW409';end if;
 if tg_op='DELETE' then return old;end if;return new;
end $$;
create trigger proteger_transacao_conciliada before update or delete on public.transacoes_origem for each row execute function public.fn_proteger_transacao_conciliada();
revoke all on function public.fn_proteger_transacao_conciliada() from public,anon,authenticated;
create function public.fn_proteger_quitacao_conciliada() returns trigger language plpgsql security definer set search_path='' as $$
declare vinculado boolean;begin
 if exists(select 1 from auth.users where id=old.user_id) then
 if tg_table_name='faturas' then select exists(select 1 from public.movimentos_conta where fatura_id=old.id) into vinculado;
 else select exists(select 1 from public.movimentos_conta where transacao_id=old.transacao_id or fatura_id=old.fatura_id) into vinculado;end if;
 if vinculado then raise exception 'Quitação conciliada: desfaça a conciliação antes de alterar ou estornar.' using errcode='FW409';end if;
 end if;
 if tg_op='DELETE' then return old;end if;return new;
end $$;
create trigger proteger_fatura_conciliada before update or delete on public.faturas for each row execute function public.fn_proteger_quitacao_conciliada();
create trigger proteger_parcela_conciliada before update or delete on public.parcelas for each row execute function public.fn_proteger_quitacao_conciliada();
revoke all on function public.fn_proteger_quitacao_conciliada() from public,anon,authenticated;
revoke all on function public.criar_conta_bancaria(text,bigint,date) from public,anon,authenticated;
grant execute on function public.criar_conta_bancaria(text,bigint,date) to authenticated;
revoke all on function public.transferir_entre_contas(uuid,uuid,bigint,date,uuid) from public,anon,authenticated;
grant execute on function public.transferir_entre_contas(uuid,uuid,bigint,date,uuid) to authenticated;
revoke all on function public.importar_extrato_conta(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.importar_extrato_conta(uuid,text,jsonb) to authenticated;
revoke all on function public.conciliar_linha_conta(uuid,text,uuid,uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.conciliar_linha_conta(uuid,text,uuid,uuid,uuid,uuid) to authenticated;
revoke all on function public.desfazer_conciliacao_conta(uuid) from public,anon,authenticated;
grant execute on function public.desfazer_conciliacao_conta(uuid) to authenticated;
revoke all on function public.fechar_conciliacao_conta(uuid,date,bigint) from public,anon,authenticated;
grant execute on function public.fechar_conciliacao_conta(uuid,date,bigint) to authenticated;
revoke all on function public.reabrir_conciliacao_conta(uuid,text) from public,anon,authenticated;
grant execute on function public.reabrir_conciliacao_conta(uuid,text) to authenticated;
revoke all on function public.consultar_conta_bancaria(uuid,date,date) from public,anon,authenticated;
grant execute on function public.consultar_conta_bancaria(uuid,date,date) to authenticated;
