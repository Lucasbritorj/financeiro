-- Contratos entre a central existente e as edições integradas posteriormente.
begin;
do $$
declare
  u uuid := '00000000-0000-0000-0000-0000000000da';
  assinatura uuid; recorrencia uuid;
begin
  insert into auth.users(id,email) values(u,'integracao-assinaturas@local.test');
  perform set_config('request.jwt.claims',jsonb_build_object('sub',u)::text,true);
  assinatura := (public.criar_assinatura('Plano',1000,'MENSAL',current_date+10,null,null)->>'assinatura_id')::uuid;
  begin
    perform public.editar_recorrencia(assinatura,'Invasão de contrato',1000,'DESPESA','PIX',5,null);
    raise exception 'T1: editar_recorrencia aceitou assinatura';
  exception when sqlstate 'FW404' then null; end;
  recorrencia := (public.criar_recorrencia('Conta mensal',1000,'DESPESA','PIX',5)->>'recorrencia_id')::uuid;
  begin
    perform public.editar_recorrencia(recorrencia,'Acima do teto',1000000000000,'DESPESA','PIX',5,null);
    raise exception 'T2: edição aceitou valor acima do teto';
  exception when sqlstate 'FW400' then null; end;
  if not exists(select 1 from public.recorrencias where id=assinatura and descricao='Plano' and finalidade='ASSINATURA') then
    raise exception 'T3: assinatura foi alterada pela edição de recorrência';
  end if;
  raise notice 'OK: 3/3 asserts (integração entre cadastros e assinaturas)';
end $$;
rollback;
