begin;
do $$
declare
 u uuid := '00000000-0000-0000-0000-0000000000d1';
 outro uuid := '00000000-0000-0000-0000-0000000000d2';
 cartao uuid; cartao_outro uuid; r jsonb; plano uuid; contrato uuid; antes bigint;
 linhas jsonb := '[{"data":"2026-10-05","descricao":"LOJA MOVEIS 03/10","valor":10000,"tipo":"PARCELA","parcela_numero":3,"parcelas_total":10}]';
begin
 insert into auth.users(id,email) values(u,'fatura@local.test'),(outro,'outra-fatura@local.test');
 insert into public.cartoes_credito(user_id,nome,limite_total,dia_fechamento,dia_vencimento) values(u,'Cartão teste',500000,25,5) returning id into cartao;
 insert into public.cartoes_credito(user_id,nome,limite_total,dia_fechamento,dia_vencimento) values(outro,'Outro',100000,25,5) returning id into cartao_outro;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',u)::text,true);
 r := public.confirmar_fatura_importada('10000000-0000-0000-0000-000000000001',repeat('a',64),cartao,'2026-10-01','PDF',linhas,null,true);
 if (r->>'criadas')::int<>1 then raise exception 'T1: cobrança ausente'; end if;
 if (select sum(valor) from public.parcelas where user_id=u)<>10000 then raise exception 'T2: inventou passado/futuro efetivo'; end if;
 if (select count(*) from public.vw_previsoes_parcelamento where user_id=u)<>7 then raise exception 'T3: previsão incorreta'; end if;
 select id into plano from public.planos_parcelamento where user_id=u;
 r := public.confirmar_fatura_importada('10000000-0000-0000-0000-000000000001',repeat('a',64),cartao,'2026-10-01','PDF',linhas,null,true);
 if not (r->>'repetida')::boolean or (select count(*) from public.transacoes_origem where user_id=u)<>1 then raise exception 'T4: repetição duplicou'; end if;
 r := public.confirmar_fatura_importada('10000000-0000-0000-0000-000000000002',repeat('b',64),cartao,'2026-10-01','CSV',linhas,null,true);
 if (r->>'duplicadas')::int<>1 then raise exception 'T5: exportação diferente duplicou'; end if;
 linhas := jsonb_build_array(jsonb_build_object('data','2026-11-05','descricao','LOJA MOVEIS 04/10','valor',11000,'tipo','PARCELA','parcela_numero',4,'parcelas_total',10,'plano_id',plano,'decisao_duplicidade','NOVA'));
 perform public.confirmar_fatura_importada('10000000-0000-0000-0000-000000000003',repeat('c',64),cartao,'2026-11-01','PDF',linhas,null,true);
 if (select count(*) from public.vw_previsoes_parcelamento where user_id=u)<>6 then raise exception 'T6: não conciliou previsão'; end if;
 if (select sum(valor) from public.parcelas where user_id=u)<>21000 then raise exception 'T7: valor efetivo foi substituído por previsto'; end if;
 begin
  perform public.confirmar_fatura_importada(gen_random_uuid(),null,cartao_outro,'2026-10-01','PDF',linhas,null,true);
  raise exception 'T8: aceitou cartão de outro usuário';
 exception when sqlstate 'FW404' then null; end;
 begin
  perform public.confirmar_fatura_importada(gen_random_uuid(),null,cartao,'2026-12-01','PDF','[{"data":"2026-12-01","descricao":"ESTORNO","valor":1000,"tipo":"AJUSTE"}]',null,true);
  raise exception 'T9: estorno virou compra';
 exception when sqlstate 'FW400' then null; end;
 select count(*) into antes from public.transacoes_origem where user_id=u;
 begin
  perform public.confirmar_fatura_importada(gen_random_uuid(),null,cartao,'2026-12-01','PDF','[{"data":"2026-12-01","descricao":"COMPRA OK","valor":1000,"tipo":"GASTO"},{"data":"2026-12-02","descricao":"INVALIDA","valor":1.5,"tipo":"GASTO"}]',null,true);
  raise exception 'T10: aceitou fração';
 exception when sqlstate 'FW400' then null; end;
 if (select count(*) from public.transacoes_origem where user_id=u)<>antes then raise exception 'T11: lote parcial'; end if;
 linhas := jsonb_build_array(jsonb_build_object('data','2026-10-02','descricao','NETFLIX','valor',3990,'tipo','ASSINATURA','decisao_assinatura','NOVA','periodicidade','MENSAL','proxima_cobranca',current_date+30,'decisao_duplicidade','NOVA'));
 perform public.confirmar_fatura_importada(gen_random_uuid(),null,cartao,'2026-10-01','PDF',linhas,null,true);
 select id into contrato from public.recorrencias where user_id=u and finalidade='ASSINATURA';
 if contrato is null or (select count(*) from public.transacoes_origem where user_id=u)<>antes+1 then raise exception 'T12: assinatura ausente ou despesa dupla'; end if;
 if has_function_privilege('anon','public.confirmar_fatura_importada(uuid,text,uuid,date,text,jsonb,bigint,boolean)','execute') then raise exception 'T13: anon pode escrever'; end if;
 if has_table_privilege('authenticated','public.planos_parcelamento','insert') then raise exception 'T14: escrita direta liberada'; end if;
 perform public.editar_previsao_parcelamento(plano,12000);
 if (select sum(valor) from public.parcelas where user_id=u)<>24990 then raise exception 'T16: editar previsão alterou gasto efetivo'; end if;
 if exists(select 1 from public.vw_previsoes_parcelamento where user_id=u and valor<>12000) then raise exception 'T17: previsão não editada'; end if;
 begin
  perform public.confirmar_fatura_importada('10000000-0000-0000-0000-000000000001',null,cartao,'2026-12-01','PDF',linhas,null,true);
  raise exception 'T18: chave reaproveitada para conteúdo diferente';
 exception when sqlstate 'FW409' then null; end;
 begin
  perform public.confirmar_fatura_importada(gen_random_uuid(),null,cartao,'2026-12-01','PDF','[{"ignorar":true}]',null,true);
  raise exception 'T19: criou fatura sem cobranças';
 exception when sqlstate 'FW400' then null; end;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',outro)::text,true);
 if exists(select 1 from public.vw_previsoes_parcelamento where user_id=outro) then raise exception 'T15: previsão alheia'; end if;
 begin
  perform public.editar_previsao_parcelamento(plano,500);
  raise exception 'T20: outro usuário editou plano';
 exception when sqlstate 'FW404' then null; end;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',u)::text,true);
 perform public.processar_transacao_completa('MANUAL PARCELADA',120000,'DESPESA','CREDITO',cartao,'2026-08-05',12);
 begin
  perform public.confirmar_fatura_importada(gen_random_uuid(),null,cartao,'2026-10-01','PDF','[{"data":"2026-08-05","descricao":"MANUAL PARCELADA 03/12","valor":10000,"tipo":"PARCELA","parcela_numero":3,"parcelas_total":12}]',null,true);
  raise exception 'T22: parcela manual preexistente duplicada sem revisão';
 exception when sqlstate 'FW409' then null; end;
 begin
  perform public.confirmar_fatura_importada(gen_random_uuid(),null,cartao,'2026-10-01','CSV','[{"data":"2026-10-05","descricao":"LOJA","valor":2000,"tipo":"GASTO","natureza_valor":"CREDITO"}]',null,true);
  raise exception 'T23: crédito explícito reclassificado como compra';
 exception when sqlstate 'FW400' then null; end;
 linhas := '[{"data":"2026-10-05","descricao":"LOJA MOVEIS 03/10","valor":10000,"tipo":"PARCELA","parcela_numero":3,"parcelas_total":10,"decisao_duplicidade":"NOVA"}]';
 r:=public.confirmar_fatura_importada('10000000-0000-0000-0000-000000000004',repeat('d',64),cartao,'2026-10-01','PDF',linhas,null,true);
 if (r->>'criadas')::int<>1 then raise exception 'T21: compra igual legítima explicitamente nova foi descartada'; end if;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',outro)::text,true);
 raise notice 'OK: 23/23 asserts (importação de fatura, parcelas, repetição e isolamento)';
end $$;
set local role authenticated;
do $$ begin
 if exists(select 1 from public.planos_parcelamento) or exists(select 1 from public.cobrancas_importadas) or exists(select 1 from public.lotes_fatura) or exists(select 1 from public.vw_previsoes_parcelamento) then
  raise exception 'RLS: outro usuário enxerga dados da conta de teste';
 end if;
end $$;
reset role;
rollback;
