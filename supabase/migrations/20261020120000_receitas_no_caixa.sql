alter table public.transacoes_origem
 add column observacao text check(length(observacao)<=2000),
 add column chave_receita uuid,
 add column hash_receita text;
create unique index transacoes_receita_tentativa on public.transacoes_origem(user_id,chave_receita) where chave_receita is not null;
alter table public.transacoes_origem drop constraint transacoes_origem_forma_pagamento_check;
alter table public.transacoes_origem add constraint transacoes_origem_forma_pagamento_check check(forma_pagamento in('CREDITO','DEBITO','PIX','DINHEIRO','BOLETO','TRANSFERENCIA'));

-- Amplia apenas o ramo à vista do motor existente, preservando seus guards,
-- limites, assinatura e estornos em cartão. Falha se o contrato mudar.
do $migracao$
declare ddl text; alvo text; antigo text:='p_forma_pagamento not in (''CREDITO'',''DEBITO'',''PIX'',''DINHEIRO'')';
begin
 ddl:=pg_get_functiondef('public.processar_transacao_completa(text,bigint,text,text,uuid,date,integer)'::regprocedure);
 if strpos(ddl,antigo)=0 then raise exception 'Contrato do motor mudou; conferir antes de instalar.';end if;
 execute replace(ddl,antigo,'p_forma_pagamento not in (''CREDITO'',''DEBITO'',''PIX'',''DINHEIRO'',''TRANSFERENCIA'')');
 alvo:='public.consultar_conta_bancaria(uuid,date,date)';
 ddl:=pg_get_functiondef(alvo::regprocedure);
 antigo:='(''PIX'',''DEBITO'',''DINHEIRO'')';
 if strpos(ddl,antigo)=0 then raise exception 'Contrato dos candidatos mudou.';end if;
 execute replace(ddl,antigo,'(''PIX'',''DEBITO'',''DINHEIRO'',''TRANSFERENCIA'')');
 ddl:=pg_get_functiondef('public.conciliar_linha_conta(uuid,text,uuid,uuid,uuid,uuid)'::regprocedure);
 antigo:='(''PIX'',''DEBITO'',''DINHEIRO'',''BOLETO'')';
 if strpos(ddl,antigo)=0 then raise exception 'Contrato da conciliação mudou.';end if;
 execute replace(ddl,antigo,'(''PIX'',''DEBITO'',''DINHEIRO'',''BOLETO'',''TRANSFERENCIA'')');
 -- A substituição já trava a origem. Move a chave junto com a nota na
 -- mesma transação, mantendo a repetição da tentativa original sem duplicar.
 ddl:=pg_get_functiondef('public.substituir_transacao(uuid,text,bigint,text,text,uuid,date,integer,uuid)'::regprocedure);
 antigo:='update public.transacoes_origem set deleted_at=now() where id=v_old.id;';
 if strpos(ddl,antigo)=0 then raise exception 'Contrato da substituição mudou.';end if;
 ddl:=replace(ddl,antigo,'update public.transacoes_origem set deleted_at=now(), chave_receita=null, hash_receita=null where id=v_old.id;');
 antigo:='fatura_liquidada_id = v_old.fatura_liquidada_id';
 if strpos(ddl,antigo)=0 then raise exception 'Contrato dos metadados mudou.';end if;
 execute replace(ddl,antigo,'fatura_liquidada_id = v_old.fatura_liquidada_id, observacao = v_old.observacao, chave_receita = v_old.chave_receita, hash_receita = v_old.hash_receita');
end $migracao$;

create function public.registrar_receita(p_chave uuid,p_descricao text,p_valor bigint,p_forma text,p_data date,p_observacao text,p_categoria_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); h text; anterior public.transacoes_origem; resultado jsonb; id_novo uuid;
begin
 if u is null then raise exception 'Não autenticado.' using errcode='FW401';end if;
 if p_chave is null or p_forma is null or p_forma not in('PIX','TRANSFERENCIA','DINHEIRO') or p_valor is null or p_valor not between 1 and 9007199254740991
 or p_data is null or p_data not between '2000-01-01' and '2099-12-31' or coalesce(length(trim(p_descricao)),0) not between 1 and 500 or coalesce(length(p_observacao),0)>2000 then
  raise exception 'Receita inválida. Informe descrição, valor positivo, data e recebimento por Pix, transferência ou dinheiro.' using errcode='FW400';
 end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('receita:'||u::text||':'||p_chave::text,0));
 h:=md5(jsonb_build_object('descricao',trim(p_descricao),'valor',p_valor,'forma',p_forma,'data',p_data,'observacao',nullif(trim(p_observacao),''),'categoria',p_categoria_id)::text);
 select * into anterior from public.transacoes_origem where user_id=u and chave_receita=p_chave;
 if found then
  if anterior.hash_receita<>h then raise exception 'Essa tentativa já foi registrada com outros dados. Confira as transações antes de iniciar outro lançamento.' using errcode='FW409';end if;
  return jsonb_build_object('transacao_id',anterior.id,'repetida',true);
 end if;
 if p_categoria_id is not null then
  perform 1 from public.categorias where id=p_categoria_id and user_id=u and tipo='RECEITA' and deleted_at is null for share;
  if not found then raise exception 'Categoria de receita não encontrada.' using errcode='FW404';end if;
 end if;
 resultado:=public.processar_transacao_completa(trim(p_descricao),p_valor,'RECEITA',p_forma,null,p_data,1);
 id_novo:=(resultado->>'transacao_id')::uuid;
 if id_novo is null then raise exception 'Receita sem identificador.';end if;
 update public.transacoes_origem set observacao=nullif(trim(p_observacao),''),chave_receita=p_chave,hash_receita=h where id=id_novo and user_id=u;
 if p_categoria_id is not null then perform public.definir_categoria_transacao(id_novo,p_categoria_id);end if;
 return resultado||jsonb_build_object('repetida',false);
end $$;
revoke all on function public.registrar_receita(uuid,text,bigint,text,date,text,uuid) from public,anon,authenticated;
grant execute on function public.registrar_receita(uuid,text,bigint,text,date,text,uuid) to authenticated;

-- Mesmo regime de caixa: crédito sai somente na quitação, boleto quando pago.
create or replace view public.vw_carteira with(security_invoker=true) as
with totais as (
 select
 coalesce(sum(valor_total) filter(where tipo='RECEITA'),0)::bigint as entradas,
 coalesce(sum(valor_total) filter(where tipo='DESPESA' and forma_pagamento in('DEBITO','PIX','DINHEIRO','TRANSFERENCIA') and natureza='CONSUMO'),0)::bigint as saidas_avista
 from public.transacoes_origem where deleted_at is null
), pagamentos as (
 select coalesce((select sum(valor_total_fatura) from public.vw_faturas_consolidadas where status='PAGA'),0)::bigint as faturas_pagas,
 coalesce((select sum(t.valor_total) from public.transacoes_origem t join public.parcelas p on p.transacao_id=t.id and p.deleted_at is null where t.forma_pagamento='BOLETO' and t.tipo='DESPESA' and t.deleted_at is null and p.status='PAGA'),0)::bigint as boletos_pagos
)
select entradas,saidas_avista,faturas_pagas,(entradas-saidas_avista-faturas_pagas-boletos_pagos)::bigint as saldo_caixa,boletos_pagos from totais cross join pagamentos;
revoke all on public.vw_carteira from public,anon,authenticated;
grant select on public.vw_carteira to authenticated;
