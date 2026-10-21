begin;
insert into auth.users(id) values('00000000-0000-0000-0000-0000000000f1');
select public.configurar_chave_rpc_servidor(repeat('a',64));
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-0000000000f1","role":"authenticated"}',true);
select set_config('app.assinatura_teste',jsonb_build_object(
 'x-financeiro-tempo',floor(extract(epoch from now()))::bigint::text,
 'x-financeiro-assinatura',encode(extensions.hmac(convert_to(floor(extract(epoch from now()))::bigint::text||'|00000000-0000-0000-0000-0000000000f1|criar_importacao','UTF8'),decode(repeat('a',64),'hex'),'sha256'),'hex'))::text,true);
set session authorization authenticated;
do $$begin
 begin perform public.criar_importacao('CSV','[]'::jsonb);raise exception 'Sem assinatura passou.';exception when sqlstate 'FW403' then null;end;
 perform set_config('request.headers','{"x-financeiro-tempo":"1790000000","x-financeiro-assinatura":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}',true);
 begin perform public.exigir_api_servidor('criar_importacao');raise exception 'Expirada passou.';exception when sqlstate 'FW403' then null;end;
 perform set_config('request.headers',current_setting('app.assinatura_teste'),true);
 begin perform public.exigir_api_servidor('confirmar_importacao');raise exception 'Outra função passou.';exception when sqlstate 'FW403' then null;end;
 perform set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-0000000000f2"}',true);
 begin perform public.exigir_api_servidor('criar_importacao');raise exception 'Outro usuário passou.';exception when sqlstate 'FW403' then null;end;
 perform set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-0000000000f1"}',true);
 perform public.exigir_api_servidor('criar_importacao');
 perform public.criar_importacao('CSV','[{"data":"2026-10-21","descricao":"fixture","valor":100}]'::jsonb);
 if has_table_privilege('authenticated','public.configuracao_rpc_servidor','SELECT') then raise exception 'Chave acessível.';end if;
 if has_function_privilege('authenticated','public.configurar_chave_rpc_servidor(text)','execute') then raise exception 'Configuração acessível.';end if;
 if has_function_privilege('anon','public.exigir_api_servidor(text)','execute') then raise exception 'Guard anônimo.';end if;
 raise notice 'OK: 9/9 asserts';
end $$;
reset session authorization;
rollback;
