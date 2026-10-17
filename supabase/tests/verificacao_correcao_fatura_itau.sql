begin;
do $$
declare
 u uuid := '00000000-0000-0000-0000-0000000000e1';
 outro uuid := '00000000-0000-0000-0000-0000000000e2';
 c uuid; p uuid; lote uuid:=gen_random_uuid(); linhas jsonb; r jsonb; n bigint;
begin
 insert into auth.users(id,email) values(u,'correcao-fatura@local.test'),(outro,'correcao-outra@local.test');
 insert into public.cartoes_credito(user_id,nome,limite_total,dia_fechamento,dia_vencimento) values(u,'Cartão fictício',100000,1,8) returning id into c;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',u)::text,true);
 linhas:='[{"data":"2026-07-07","descricao":"LOJA FICTICIA 3/5","valor":8211,"tipo":"PARCELA","parcela_numero":3,"parcelas_total":5,"valor_previsto":8209,"data_confirmada":true}]';
 r:=public.confirmar_fatura_importada(lote,null,c,'2026-09-01','PDF',linhas,8211,false);
 select id into p from public.planos_parcelamento where user_id=u;
 if (select valor_previsto from public.planos_parcelamento where id=p)<>8209 then raise exception 'T1: perdeu valor futuro'; end if;
 if (select sum(valor) from public.vw_previsoes_parcelamento where user_id=u)<>16418 then raise exception 'T2: arredondamento futuro'; end if;
 if (select sum(valor) from public.parcelas where user_id=u)<>8211 then raise exception 'T3: alterou atual'; end if;
 r:=public.confirmar_fatura_importada(lote,null,c,'2026-09-01','PDF',linhas,8211,false);
 if not(r->>'repetida')::boolean then raise exception 'T4: retry duplicado'; end if;
 select count(*) into n from public.transacoes_origem where user_id=u;
 begin
  perform public.confirmar_fatura_importada(gen_random_uuid(),null,c,'2026-09-01','PDF',jsonb_set(linhas,'{0,data_confirmada}','false'),8211,false);
  raise exception 'T5: data não confirmada aceita';
 exception when sqlstate 'FW400' then null; end;
 begin
  perform public.confirmar_fatura_importada(gen_random_uuid(),null,c,'2026-09-01','PDF',jsonb_set(linhas,'{0,valor_previsto}','-1'),8211,false);
  raise exception 'T6: previsão negativa aceita';
 exception when sqlstate 'FW400' then null; end;
 begin
  perform public.confirmar_fatura_importada(gen_random_uuid(),null,c,'2026-09-01','PDF',linhas,99999,true);
  raise exception 'T7: PDF divergente aceito';
 exception when sqlstate 'FW400' then null; end;
 if (select count(*) from public.transacoes_origem where user_id=u)<>n then raise exception 'T8: lote parcial'; end if;
 if (select sum(valor_total) from public.vw_movimentos_competencia where user_id=u and data_compra='2026-09-01')<>8211 then raise exception 'T9: competência incorreta'; end if;
 if exists(select 1 from public.vw_movimentos_competencia where user_id=u and data_compra='2026-07-07') then raise exception 'T10: compra antiga duplicou histórico'; end if;
 if has_table_privilege('anon','public.vw_movimentos_competencia','select') then raise exception 'T11: acesso anônimo'; end if;
 if not exists(select 1 from pg_class where oid='public.vw_movimentos_competencia'::regclass and reloptions @> array['security_invoker=true']) then raise exception 'T12: view sem isolamento do chamador'; end if;
 perform public.processar_transacao_completa('RECEITA FICTICIA',10000,'RECEITA','PIX',null,'2026-09-15',1);
 perform public.processar_transacao_completa('DEBITO FICTICIO',500,'DESPESA','DEBITO',null,'2026-09-16',1);
 perform public.processar_transacao_completa('MANUAL PARCELADA FICTICIA',10000,'DESPESA','CREDITO',c,'2026-08-10',2);
 if (select sum(valor_total) from public.vw_movimentos_competencia where user_id=u and tipo='RECEITA')<>10000 then raise exception 'T13: receita mudou'; end if;
 if (select sum(valor_total) from public.vw_movimentos_competencia where user_id=u and descricao='DEBITO FICTICIO')<>500 then raise exception 'T14: débito mudou'; end if;
 if (select sum(valor_total) from public.vw_movimentos_competencia where user_id=u and descricao='MANUAL PARCELADA FICTICIA' and data_compra='2026-09-01')<>5000 then raise exception 'T15: parcela manual duplicou'; end if;
end $$;
-- Executa SELECT com o papel real autenticado, não apenas como dono das tabelas.
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-0000000000e2"}',true);
do $$ begin
 if exists(select 1 from public.vw_movimentos_competencia where user_id='00000000-0000-0000-0000-0000000000e1') then raise exception 'vazamento cross-tenant'; end if;
 raise notice 'OK: 16/16 asserts correção fatura e isolamento competência';
end $$;
rollback;
