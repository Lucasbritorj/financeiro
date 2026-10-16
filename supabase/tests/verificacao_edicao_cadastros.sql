-- Edições preservam histórico e isolam usuários; nenhum dado persiste.
begin;
do $teste$
declare
  u uuid := '00000000-0000-0000-0000-0000000000d1';
  outro uuid := '00000000-0000-0000-0000-0000000000d2';
  cartao uuid; cofre uuid; cat uuid; rec uuid; tx uuid;
  antes jsonb; depois jsonb; saldo bigint; proxima date;
begin
  insert into auth.users(id,email) values(u,'edicao1@local.test'),(outro,'edicao2@local.test');
  perform set_config('request.jwt.claims', json_build_object('sub',u)::text,true);
  cartao := (public.criar_cartao('Edição cartão',100000,20,10)->>'cartao_id')::uuid;
  tx := (public.processar_transacao_completa('Compra preservada',10000,'DESPESA','CREDITO',cartao,date '2026-01-05',1)->>'transacao_id')::uuid;
  select jsonb_agg(to_jsonb(p) order by p.id) into antes from public.parcelas p where transacao_id=tx;
  perform public.editar_cartao(cartao,'Novo nome',120000,25,12);
  select jsonb_agg(to_jsonb(p) order by p.id) into depois from public.parcelas p where transacao_id=tx;
  if antes is distinct from depois or not exists(select 1 from public.cartoes_credito where id=cartao and nome='Novo nome' and limite_total=120000 and dia_fechamento=25 and dia_vencimento=12) then raise exception 'T1: edição do cartão alterou passado ou não salvou'; end if;
  begin
    perform public.editar_cartao(cartao,'Inválido',9999,20,10);
    raise exception 'T2: aceitou limite inferior ao comprometido';
  exception when sqlstate 'FW409' then null; end;
  begin
    perform public.editar_cartao(cartao,'Inválido',120000,0,32);
    raise exception 'T3: aceitou dias inválidos';
  exception when sqlstate 'FW400' then null; end;

  cofre := (public.criar_cofrinho('Meta',100000,'MEDIO')->>'cofrinho_id')::uuid;
  perform public.aportar_cofrinho(cofre,1000,date '2026-01-01');
  select jsonb_agg(to_jsonb(m) order by m.id) into antes from public.movimentacoes_cofrinho m where cofrinho_id=cofre;
  perform public.editar_cofrinho(cofre,'Meta nova',50000,'LONGO',null);
  select saldo_atual into saldo from public.cofrinhos where id=cofre;
  select jsonb_agg(to_jsonb(m) order by m.id) into depois from public.movimentacoes_cofrinho m where cofrinho_id=cofre;
  if saldo<>1000 or antes is distinct from depois or not exists(select 1 from public.cofrinhos where id=cofre and nome='Meta nova' and valor_alvo=50000 and horizonte='LONGO' and data_alvo is null) then raise exception 'T4: edição de meta mudou saldo/histórico ou não salvou'; end if;
  begin
    perform public.editar_cofrinho(cofre,'Inválida',0,'MEDIO',null);
    raise exception 'T5: aceitou alvo inválido';
  exception when sqlstate 'FW400' then null; end;

  cat := (public.criar_categoria('Categoria de edição')->>'categoria_id')::uuid;
  perform public.editar_categoria(cat,'Categoria nova','#D9A24E','house');
  if not exists(select 1 from public.categorias where id=cat and nome='Categoria nova' and icone='house' and cor='#D9A24E') then raise exception 'T6: categoria não foi editada'; end if;
  rec := (public.criar_recorrencia('Aluguel',10000,'DESPESA','PIX',5,cat,date '2026-01-01')->>'recorrencia_id')::uuid;
  select proxima_data into proxima from public.recorrencias where id=rec;
  perform public.editar_recorrencia(rec,'Aluguel novo',20000,'DESPESA','DEBITO',10,cat);
  if not exists(select 1 from public.recorrencias where id=rec and descricao='Aluguel novo' and valor=20000 and dia_do_mes=10 and proxima_data=public.fn_proxima_ocorrencia(proxima,10)) then raise exception 'T7: recorrência não preservou mês pendente'; end if;
  begin
    perform public.editar_recorrencia(rec,'Inválida',20000,'RECEITA','PIX',10,cat);
    raise exception 'T8: aceitou categoria incompatível';
  exception when sqlstate 'FW404' then null; end;

  perform set_config('request.jwt.claims', json_build_object('sub',outro)::text,true);
  begin
    perform public.editar_cartao(cartao,'Invasão',500000,1,2);
    raise exception 'T9: cartão alheio foi editado';
  exception when sqlstate 'FW404' then null; end;
  begin
    perform public.editar_cofrinho(cofre,'Invasão',500000,'MEDIO',null);
    raise exception 'T10: cofrinho alheio foi editado';
  exception when sqlstate 'FW404' then null; end;
  begin
    perform public.editar_recorrencia(rec,'Invasão',100,'DESPESA','PIX',1,null);
    raise exception 'T11: recorrência alheia foi editada';
  exception when sqlstate 'FW404' then null; end;
  begin
    perform public.editar_categoria(cat,'Invasão');
    raise exception 'T12: categoria alheia foi editada';
  exception when sqlstate 'FW404' then null; end;
  perform set_config('request.jwt.claims','{}',true);
  begin
    perform public.editar_cartao(cartao,'Sem sessão',100000,1,2);
    raise exception 'T13: sem sessão editou';
  exception when sqlstate 'FW401' then null; end;
  if has_function_privilege('anon','public.editar_cartao(uuid,text,bigint,integer,integer)','execute')
    or has_function_privilege('anon','public.editar_cofrinho(uuid,text,bigint,text,date)','execute')
    or has_function_privilege('anon','public.editar_recorrencia(uuid,text,bigint,text,text,integer,uuid)','execute') then raise exception 'T14: anon pode editar'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub',u)::text,true);
  begin
    perform public.editar_categoria(cat,'Válida','não-é-cor');
    raise exception 'T15: aceitou cor inválida';
  exception when sqlstate 'FW400' then null; end;
  begin
    perform public.editar_categoria(cat,'   ');
    raise exception 'T16: aceitou nome vazio';
  exception when sqlstate 'FW400' then null; end;
  begin
    perform public.editar_categoria(cat,repeat('x',121));
    raise exception 'T17: aceitou nome acima do limite';
  exception when sqlstate 'FW400' then null; end;
  begin
    perform public.editar_categoria(cat,null,null,repeat('x',81));
    raise exception 'T18: aceitou ícone acima do limite';
  exception when sqlstate 'FW400' then null; end;
  raise notice 'OK: 18/18 asserts (edição de cadastros)';
end;
$teste$;
rollback;
