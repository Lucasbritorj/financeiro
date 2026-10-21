-- O vínculo externo só é aceito após validação de titular/provedor no servidor.
revoke all on function public.vincular_conta_pluggy(uuid,text,text) from public,anon,authenticated,service_role;

create function public.vincular_conta_pluggy_servidor(p_user_id uuid,p_conta_id uuid,p_account_id text,p_item_id text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare a public.contas_bancarias;
begin
 if (current_setting('request.jwt.claims',true)::jsonb->>'role') is distinct from 'service_role' then
  raise exception 'Operação exclusiva do servidor.' using errcode='FW403';
 end if;
 if p_user_id is null or p_account_id is null or p_item_id is null or p_account_id !~ '^[a-zA-Z0-9-]{1,100}$' or p_item_id !~ '^[a-zA-Z0-9-]{1,100}$' then
  raise exception 'Conexão inválida.' using errcode='FW400';
 end if;
 select * into a from public.contas_bancarias where id=p_conta_id and user_id=p_user_id for update;
 if not found then raise exception 'Conta não encontrada.' using errcode='FW404';end if;
 if a.pluggy_account_id is not null then
  if a.pluggy_account_id=p_account_id and a.pluggy_item_id=p_item_id then return jsonb_build_object('vinculada',true);end if;
  raise exception 'Conta já vinculada a outra conexão.' using errcode='FW409';
 end if;
 update public.contas_bancarias set pluggy_account_id=p_account_id,pluggy_item_id=p_item_id where id=a.id;
 insert into public.historico_conciliacao(user_id,conta_id,evento,detalhes) values(p_user_id,a.id,'CONEXAO_PLUGGY',jsonb_build_object('vinculada',true));
 return jsonb_build_object('vinculada',true);
end $$;
revoke all on function public.vincular_conta_pluggy_servidor(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.vincular_conta_pluggy_servidor(uuid,uuid,text,text) to service_role;
