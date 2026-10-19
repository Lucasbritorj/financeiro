begin;
do $$ begin
 if has_function_privilege('authenticated','public.vincular_conta_pluggy(uuid,text,text)','execute') or has_function_privilege('anon','public.vincular_conta_pluggy(uuid,text,text)','execute') then raise exception 'RPC legada permite reserva de identificador externo';end if;
end $$;
do $$
declare u uuid:='00000000-0000-0000-0000-0000000000e1'; outro uuid:='00000000-0000-0000-0000-0000000000e2'; a uuid; b uuid;
begin
 if has_function_privilege('authenticated','public.vincular_conta_pluggy_servidor(uuid,uuid,text,text)','execute') or has_function_privilege('anon','public.vincular_conta_pluggy_servidor(uuid,uuid,text,text)','execute') then raise exception 'Nova RPC aberta ao cliente';end if;
 if not has_function_privilege('service_role','public.vincular_conta_pluggy_servidor(uuid,uuid,text,text)','execute') then raise exception 'Servidor não autorizado';end if;
 insert into auth.users(id) values(u),(outro);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',u)::text,true);
 a:=(public.criar_conta_bancaria('Teste Pluggy A',0,'2026-10-01')->>'id')::uuid;
 b:=(public.criar_conta_bancaria('Teste Pluggy B',0,'2026-10-01')->>'id')::uuid;
 perform set_config('request.jwt.claims','{"role":"authenticated"}',true);
 begin perform public.vincular_conta_pluggy_servidor(u,a,'account-ficticio','item-ficticio');raise exception 'Papel sem permissão passou';exception when sqlstate 'FW403' then null;end;
 perform set_config('request.jwt.claims','{"role":"service_role"}',true);
 begin perform public.vincular_conta_pluggy_servidor(outro,a,'account-ficticio','item-ficticio');raise exception 'Conta cruzada aceita';exception when sqlstate 'FW404' then null;end;
 begin perform public.vincular_conta_pluggy_servidor(null,a,'account-ficticio','item-ficticio');raise exception 'Titular nulo aceito';exception when sqlstate 'FW400' then null;end;
 perform public.vincular_conta_pluggy_servidor(u,a,'account-ficticio','item-ficticio');
 perform public.vincular_conta_pluggy_servidor(u,a,'account-ficticio','item-ficticio');
 perform set_config('test.pluggy_conta',a::text,true);
 if (select count(*) from public.historico_conciliacao where conta_id=a and evento='CONEXAO_PLUGGY')<>1 then raise exception 'Repetição duplicou histórico';end if;
 begin perform public.vincular_conta_pluggy_servidor(u,b,'account-ficticio','item-ficticio');raise exception 'ID duplicado aceito';exception when unique_violation then null;end;
 begin perform public.vincular_conta_pluggy_servidor(u,a,'outro-account','item-ficticio');raise exception 'Vínculo substituído';exception when sqlstate 'FW409' then null;end;
 raise notice 'OK: 11/11 asserts Pluggy serviço exclusivo, titular, idempotência e conflitos';
end $$;
set local role service_role;
select public.vincular_conta_pluggy_servidor('00000000-0000-0000-0000-0000000000e1',current_setting('test.pluggy_conta')::uuid,'account-ficticio','item-ficticio');
reset role;
set local role authenticated;
do $$ begin
 begin perform public.vincular_conta_pluggy('00000000-0000-0000-0000-0000000000e1','externa','item');raise exception 'Legada acessível';exception when insufficient_privilege then null;end;
 begin perform public.vincular_conta_pluggy_servidor('00000000-0000-0000-0000-0000000000e1','00000000-0000-0000-0000-0000000000e1','externa','item');raise exception 'Nova acessível';exception when insufficient_privilege then null;end;
end $$;
rollback;
