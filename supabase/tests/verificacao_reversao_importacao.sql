begin;
do $$
declare
 u uuid:='00000000-0000-0000-0000-0000000000e3'; outro uuid:='00000000-0000-0000-0000-0000000000e4';
 c uuid; lote uuid:=gen_random_uuid(); novo uuid:=gen_random_uuid(); plano uuid; imp uuid; tid uuid; r jsonb; previa jsonb; n bigint;
 linhas jsonb:='[{"data":"2026-09-01","descricao":"PARCELA FICTICIA","valor":1000,"tipo":"PARCELA","parcela_numero":1,"parcelas_total":3}]';
begin
 insert into auth.users(id,email) values(u,'reversao@local.test'),(outro,'reversao-outro@local.test');
 perform set_config('request.jwt.claims',jsonb_build_object('sub',u)::text,true);
 c:=(public.criar_cartao('Cartão reversão fictício',100000,20,8)->>'cartao_id')::uuid;
 perform public.confirmar_fatura_importada(lote,repeat('a',64),c,'2026-09-01','PDF',linhas,1000,false);
 previa:=public.consultar_reversao_importacao('FATURA',lote);
 if not(previa->>'permitido')::boolean or (previa->>'quantidade')::int<>1 or (previa->>'total')::bigint<>1000 then raise exception 'T1: prévia incorreta';end if;
 if (select count(*) from public.transacoes_origem where user_id=u and deleted_at is null)<>1 then raise exception 'T2: prévia gravou';end if;
 r:=public.desfazer_importacao('FATURA',lote,previa->>'token');
 if (select count(*) from public.transacoes_origem where user_id=u and deleted_at is null)<>0 or exists(select 1 from public.planos_parcelamento where user_id=u) then raise exception 'T3: não removeu cobranças/previsões próprias';end if;
 if (select count(*) from public.reversoes_importacao where user_id=u)<>1 then raise exception 'T4: sem auditoria';end if;
 r:=public.desfazer_importacao('FATURA',lote,previa->>'token');
 if not(r->>'repetida')::boolean or (select count(*) from public.reversoes_importacao where user_id=u)<>1 then raise exception 'T5: repetição';end if;
 begin
  perform public.confirmar_fatura_importada(lote,repeat('a',64),c,'2026-09-01','PDF',linhas,1000,false);
  raise exception 'T6: aceitou chave desfeita';
 exception when sqlstate 'FW409' then null;end;
 r:=public.confirmar_fatura_importada(novo,repeat('a',64),c,'2026-09-01','PDF',linhas,1000,false);
 if (r->>'criadas')::int<>1 or (r->>'repetida')::boolean then raise exception 'T7: não reimportou arquivo';end if;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',outro)::text,true);
 begin perform public.consultar_reversao_importacao('FATURA',novo);raise exception 'T8: acesso cruzado';exception when sqlstate 'FW404' then null;end;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',u)::text,true);
 previa:=public.consultar_reversao_importacao('FATURA',novo);
 select plano_id,transacao_id into plano,tid from public.cobrancas_importadas where lote_id=novo;
 update public.transacoes_origem set descricao='EDITADA' where id=tid;
 begin perform public.desfazer_importacao('FATURA',novo,previa->>'token');raise exception 'T9: removeu editada';exception when sqlstate 'FW409' then null;end;
 update public.faturas set status='PAGA' where cartao_id=c;
 previa:=public.consultar_reversao_importacao('FATURA',novo);
 if (previa->>'permitido')::boolean then raise exception 'T10: permitiu paga';end if;
 begin perform public.desfazer_importacao('FATURA',novo,previa->>'token');raise exception 'T11: removeu paga';exception when sqlstate 'FW409' then null;end;
 if not exists(select 1 from public.transacoes_origem where id=tid and deleted_at is null) then raise exception 'T12: reversão parcial';end if;
 -- Extrato novo com vínculo explícito; antigo confirmado permanece bloqueado.
 imp:=(public.criar_importacao('CSV','[{"data":"2026-10-01","valor":-800,"descricao":"DEBITO FICTICIO"}]',null)->>'importacao_id')::uuid;
 perform public.confirmar_importacao(imp);
 previa:=public.consultar_reversao_importacao('EXTRATO',imp);
 if not(previa->>'permitido')::boolean or (previa->>'quantidade')::int<>1 then raise exception 'T13: extrato sem vínculo';end if;
 perform public.desfazer_importacao('EXTRATO',imp,previa->>'token');
 if exists(select 1 from public.transacoes_origem where importacao_id=imp and deleted_at is null) then raise exception 'T14: extrato não revertido';end if;
 insert into public.importacoes(user_id,origem,status) values(u,'CSV','CONFIRMADA') returning id into imp;
 previa:=public.consultar_reversao_importacao('EXTRATO',imp);
 if (previa->>'permitido')::boolean then raise exception 'T15: assumiu vínculo legado';end if;
 if previa->>'quantidade' is not null then raise exception 'T16: afirmou quantidade de lote sem vínculo';end if;
 if has_function_privilege('anon','public.desfazer_importacao(text,uuid,text)','execute') or has_table_privilege('authenticated','public.reversoes_importacao','insert') then raise exception 'T16: permissão de escrita';end if;
 -- Um plano compartilhado permanece; o token também detecta edição de estimativa.
 lote:=gen_random_uuid();novo:=gen_random_uuid();
 perform public.confirmar_fatura_importada(lote,null,c,'2026-10-01','PDF',jsonb_set(jsonb_set(linhas,'{0,data}','"2026-10-01"'),'{0,decisao_duplicidade}','"NOVA"'),1000,false);
 select plano_id into plano from public.cobrancas_importadas where lote_id=lote;
 previa:=public.consultar_reversao_importacao('FATURA',lote);
 perform public.editar_previsao_parcelamento(plano,1200);
 begin perform public.desfazer_importacao('FATURA',lote,previa->>'token');raise exception 'T17: token ignorou edição';exception when sqlstate 'FW409' then null;end;
 perform public.confirmar_fatura_importada(novo,null,c,'2026-11-01','PDF',jsonb_build_array(jsonb_build_object('data','2026-10-01','descricao','PARCELA FICTICIA','valor',1000,'tipo','PARCELA','parcela_numero',2,'parcelas_total',3,'plano_id',plano)),1000,false);
 previa:=public.consultar_reversao_importacao('FATURA',lote);
 if (previa->>'planos_removidos')::int<>0 then raise exception 'T18: previu remoção de plano compartilhado';end if;
 perform public.desfazer_importacao('FATURA',lote,previa->>'token');
 if not exists(select 1 from public.planos_parcelamento where id=plano) or (select count(*) from public.cobrancas_importadas where lote_id=novo)<>1 then raise exception 'T19: removeu vínculo compartilhado';end if;
 if (select sum(valor) from public.vw_previsoes_parcelamento where plano_id=plano)<>1200 then raise exception 'T20: previsão compartilhada mudou';end if;
 lote:=gen_random_uuid();
 perform public.confirmar_fatura_importada(lote,null,c,'2026-12-01','PDF',jsonb_build_array(jsonb_build_object('data','2026-12-01','descricao','ASSINATURA FICTICIA','valor',2000,'tipo','ASSINATURA','decisao_assinatura','NOVA','periodicidade','ANUAL','proxima_cobranca',current_date+interval '1 year')),2000,false);
 previa:=public.consultar_reversao_importacao('FATURA',lote);
 if (previa->>'assinaturas_preservadas')::int<>1 then raise exception 'T21: contrato não informado';end if;
 perform public.desfazer_importacao('FATURA',lote,previa->>'token');
 if (select count(*) from public.recorrencias where user_id=u and finalidade='ASSINATURA' and deleted_at is null)<>1 then raise exception 'T22: removeu contrato';end if;
end $$;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-0000000000e4"}',true);
do $$ begin
 if exists(select 1 from public.reversoes_importacao) or exists(select 1 from public.vw_historico_importacoes) then raise exception 'T17: RLS da reversão/histórico';end if;
 raise notice 'OK: 24/24 asserts reversão, reimportação, pagamentos, legado, plano compartilhado, contrato, token e RLS';
end $$;
rollback;
