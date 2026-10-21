begin;
do $$
declare u uuid:='00000000-0000-0000-0000-0000000000eb'; a uuid;b uuid;t uuid;linha uuid;cartao uuid;fatura uuid;r jsonb;
begin
 insert into auth.users(id) values(u);perform set_config('request.jwt.claims',jsonb_build_object('sub',u)::text,true);
 a:=(public.criar_conta_bancaria('Conta quitações',50000,'2026-08-01')->>'id')::uuid;
 b:=(public.criar_conta_bancaria('Conta destino',0,'2026-08-01')->>'id')::uuid;
 -- Boleto lançado antes, pago no período: data de quitação é a data bancária.
 insert into public.transacoes_origem(user_id,descricao,valor_total,tipo,forma_pagamento,data_compra,data_vencimento,num_parcelas) values(u,'Boleto quitado',1000,'DESPESA','BOLETO','2026-08-10','2026-09-03',1) returning id into t;
 insert into public.parcelas(user_id,transacao_id,numero,valor,data_competencia,status,data_pagamento) values(u,t,1,1000,'2026-08-01','PAGA','2026-09-03T15:00:00Z');
 perform public.importar_extrato_conta(a,'OFX','[{"data":"2026-09-03","valor":-1000,"descricao":"BOLETO QUITADO","id_externo":"boleto-pago"}]');
 select id into linha from public.linhas_extrato_conta where conta_id=a and id_externo='boleto-pago';
 r:=public.consultar_conta_bancaria(a,'2026-09-01','2026-09-30');
 if not exists(select 1 from jsonb_array_elements(r->'candidatos') x where x->>'id'=t::text) then raise exception 'boleto pago ausente dos candidatos';end if;
 perform public.conciliar_linha_conta(linha,'VINCULAR',t,null,null);
 if (select count(*) from public.transacoes_origem where user_id=u)<>1 then raise exception 'boleto duplicado';end if;
 -- A quitação manual de fatura não cria transação de consumo/saída adicional.
 cartao:=(public.criar_cartao('Cartão quitado',100000,20,8)->>'cartao_id')::uuid;
 insert into public.faturas(user_id,cartao_id,competencia,data_vencimento,status) values(u,cartao,'2026-09-01','2026-09-08','PAGA') returning id into fatura;
 insert into public.transacoes_origem(user_id,descricao,valor_total,tipo,forma_pagamento,cartao_id,data_compra,num_parcelas) values(u,'Compra da fatura',2000,'DESPESA','CREDITO',cartao,'2026-08-10',1) returning id into t;
 insert into public.parcelas(user_id,transacao_id,fatura_id,numero,valor,data_competencia,status,data_pagamento) values(u,t,fatura,1,2000,'2026-09-01','PAGA','2026-09-08T15:00:00Z');
 perform public.importar_extrato_conta(a,'OFX','[{"data":"2026-09-08","valor":-2000,"descricao":"PAGAMENTO FATURA","id_externo":"fatura-paga"}]');
 select id into linha from public.linhas_extrato_conta where conta_id=a and id_externo='fatura-paga';
 perform public.conciliar_linha_conta(linha,'FATURA',null,null,null,fatura);
 perform public.conciliar_linha_conta(linha,'FATURA',null,null,null,fatura);
 if (select count(*) from public.transacoes_origem where user_id=u)<>2 then raise exception 'fatura duplicou consumo';end if;
 begin update public.faturas set status='ABERTA' where id=fatura;raise exception 'estorno de conciliada permitido';exception when sqlstate 'FW409' then null;end;
 -- A linha de outubro não confirma o saldo bancário de setembro.
 perform public.transferir_entre_contas(a,b,500,'2026-09-30',gen_random_uuid());
 perform public.importar_extrato_conta(a,'OFX','[{"data":"2026-10-02","valor":-500,"descricao":"TRANSFERENCIA","id_externo":"virada"}]');
 select id into linha from public.linhas_extrato_conta where conta_id=a and id_externo='virada';
 r:=public.consultar_conta_bancaria(a,'2026-10-01','2026-10-31');
 if not exists(select 1 from jsonb_array_elements(r->'movimentos') x where x->>'data'='2026-09-30') then raise exception 'transferência vizinha invisível';end if;
 perform public.conciliar_linha_conta(linha,'TRANSFERENCIA',null,(select id from public.movimentos_conta where conta_id=a and transferencia_id is not null),null);
 begin perform public.fechar_conciliacao_conta(a,'2026-09-30',46500);raise exception 'fechamento com linha futura permitido';exception when sqlstate 'FW409' then null;end;
 raise notice 'OK: 8/8 asserts quitações e virada do mês';
end $$;
rollback;
