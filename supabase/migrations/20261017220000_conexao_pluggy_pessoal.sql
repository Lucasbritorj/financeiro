alter table public.contas_bancarias add column pluggy_account_id text unique,add column pluggy_item_id text;
create function public.vincular_conta_pluggy(p_conta_id uuid,p_account_id text,p_item_id text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid();a public.contas_bancarias;begin
 if u is null then raise exception 'Não autenticado.' using errcode='FW401';end if;
 if p_account_id is null or p_item_id is null or p_account_id !~ '^[a-zA-Z0-9-]{1,100}$' or p_item_id !~ '^[a-zA-Z0-9-]{1,100}$' then raise exception 'Conexão inválida.' using errcode='FW400';end if;
 select * into a from public.contas_bancarias where id=p_conta_id and user_id=u for update;
 if not found then raise exception 'Conta não encontrada.' using errcode='FW404';end if;
 if a.pluggy_account_id is not null and (a.pluggy_account_id<>p_account_id or a.pluggy_item_id<>p_item_id) then raise exception 'Conta já vinculada a outra conexão. Use uma conta separada para preservar a conferência.' using errcode='FW409';end if;
 update public.contas_bancarias set pluggy_account_id=p_account_id,pluggy_item_id=p_item_id where id=a.id;
 insert into public.historico_conciliacao(user_id,conta_id,evento,detalhes) values(u,a.id,'CONEXAO_PLUGGY',jsonb_build_object('vinculada',true));
 return jsonb_build_object('vinculada',true);
end $$;
revoke all on function public.vincular_conta_pluggy(uuid,text,text) from public,anon,authenticated;
grant execute on function public.vincular_conta_pluggy(uuid,text,text) to authenticated;
