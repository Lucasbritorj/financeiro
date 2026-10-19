begin;
do $$
declare u uuid:='00000000-0000-0000-0000-0000000000e7'; outro uuid:='00000000-0000-0000-0000-0000000000e8'; c uuid; r jsonb;
begin
 insert into auth.users(id) values(u),(outro);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',u)::text,true);
 insert into public.categorias(user_id,nome,tipo,orcamento_mensal) values(u,'Teste mensal','DESPESA',5000) returning id into c;
 perform public.salvar_orcamento_mensal(c,'2026-10-01',0);
 perform public.salvar_orcamento_mensal(c,'2026-11-01',10000);
 if (select limite from public.orcamentos_mensais where categoria_id=c and mes='2026-10-01')<>0 then raise exception 'zero perdido';end if;
 if (select orcamento_mensal from public.categorias where id=c)<>5000 then raise exception 'padrão alterado';end if;
 insert into public.transacoes_origem(user_id,descricao,valor_total,tipo,forma_pagamento,data_compra,categoria_id) values(u,'Consumo orçamento',1000,'DESPESA','PIX','2026-10-01',c);
 if (select (categorias->>'orcamento_mensal')::bigint from public.vw_movimentos_competencia where user_id=u and descricao='Consumo orçamento')<>0 then raise exception 'Dashboard/Análise não respeitam orçamento do mês';end if;
 perform public.salvar_orcamento_mensal(c,'2026-10-01',null);
 if not exists(select 1 from public.orcamentos_mensais where categoria_id=c and mes='2026-10-01' and limite is null) then raise exception 'ausência explícita perdida';end if;
 begin perform public.salvar_orcamento_mensal(c,'2026-10-02',1);raise exception 'dia inválido aceito';exception when sqlstate 'FW400' then null;end;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',outro)::text,true);
 begin perform public.salvar_orcamento_mensal(c,'2026-10-01',1);raise exception 'acesso cruzado';exception when sqlstate 'FW404' then null;end;
 if has_table_privilege('authenticated','public.orcamentos_mensais','insert') or has_function_privilege('anon','public.salvar_orcamento_mensal(uuid,date,bigint)','execute') then raise exception 'permissões';end if;
 raise notice 'OK: 7/7 asserts orçamento mensal';
end $$;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-0000000000e8"}',true);
do $$ begin if exists(select 1 from public.orcamentos_mensais) then raise exception 'RLS orçamento mensal';end if;end $$;
rollback;
