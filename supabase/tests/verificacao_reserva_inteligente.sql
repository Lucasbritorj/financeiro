begin;
do $$
declare u uuid:='00000000-0000-0000-0000-0000000000d1'; v uuid:='00000000-0000-0000-0000-0000000000d2'; p jsonb:='{"intencao":100,"margem":0,"caixa":null,"compromissos":0,"receita":null,"gasto":null,"prioridades":{}}'; c uuid;
begin
 insert into auth.users(id) values(u),(v);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',u)::text,true);
 perform public.salvar_preferencias_reserva(p);
 perform public.salvar_preferencias_reserva(p||'{"intencao":200}'::jsonb);
 if (select count(*) from public.preferencias_reserva where user_id=u)<>1 or (select (dados->>'intencao')::int from public.preferencias_reserva where user_id=u)<>200 then raise exception 'upsert inválido';end if;
 if exists(select 1 from public.movimentacoes_cofrinho where user_id=u) then raise exception 'aporte indevido';end if;
 begin perform public.salvar_preferencias_reserva(p||'{"margem":-1}');raise exception 'negativo aceito';exception when sqlstate 'FW400' then null;end;
 begin perform public.salvar_preferencias_reserva(p||'{"intencao":1.5}');raise exception 'fração aceita';exception when sqlstate 'FW400' then null;end;
 begin perform public.salvar_preferencias_reserva(p||'{"extra":true}');raise exception 'extra aceito';exception when sqlstate 'FW400' then null;end;
 insert into public.cofrinhos(user_id,nome,valor_alvo,horizonte) values(v,'Outro',100,'CURTO') returning id into c;
 begin perform public.salvar_preferencias_reserva(p||jsonb_build_object('prioridades',jsonb_build_object(c,1)));raise exception 'prioridade cruzada aceita';exception when sqlstate 'FW404' then null;end;
 if has_table_privilege('authenticated','public.preferencias_reserva','insert') or has_function_privilege('anon','public.salvar_preferencias_reserva(jsonb)','execute') then raise exception 'privilégios excessivos';end if;
end $$;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-0000000000d2"}',true);
do $$ begin if exists(select 1 from public.preferencias_reserva) then raise exception 'RLS cruzada';end if;raise notice 'OK: 9/9 asserts reserva inteligente';end $$;
rollback;
