-- Edição dos cadastros: histórico financeiro e saldos permanecem intactos.
create or replace function public.editar_categoria(
  p_categoria_id uuid, p_nome text default null, p_cor text default null,
  p_icone text default null, p_orcamento_mensal bigint default null,
  p_limpar_orcamento boolean default false
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'Não autenticado.' using errcode='FW401', hint='Entre novamente.';
  end if;
  if (p_nome is not null and length(trim(p_nome)) not between 1 and 120)
    or (p_cor is not null and p_cor !~ '^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$')
    or (p_icone is not null and length(p_icone)>80)
    or (p_orcamento_mensal is not null and p_orcamento_mensal not between 1 and 9007199254740991) then
    raise exception 'Dados da categoria inválidos.' using errcode='FW400', hint='Use nome de até 120 caracteres, cor hexadecimal e orçamento positivo.';
  end if;
  update public.categorias set nome=coalesce(trim(p_nome),nome), cor=coalesce(p_cor,cor),
    icone=coalesce(p_icone,icone),
    orcamento_mensal=case when p_limpar_orcamento then null else coalesce(p_orcamento_mensal,orcamento_mensal) end
    where id=p_categoria_id and user_id=v_user_id and deleted_at is null;
  if not found then
    raise exception 'Categoria não encontrada.' using errcode='FW404', hint='Escolha uma categoria ativa da sua conta.';
  end if;
  return jsonb_build_object('categoria_id',p_categoria_id);
exception when unique_violation then
  raise exception 'Já existe categoria ativa com esse nome.' using errcode='FW409', hint='Use outro nome.';
end;
$$;

create or replace function public.editar_cartao(
  p_cartao_id uuid, p_nome text, p_limite_total bigint,
  p_dia_fechamento integer, p_dia_vencimento integer
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_user_id uuid := auth.uid();
  v_comprometido bigint;
begin
  if v_user_id is null then
    raise exception 'Não autenticado.' using errcode='FW401', hint='Entre novamente.';
  end if;
  if coalesce(length(trim(p_nome)),0) not between 1 and 120
    or p_limite_total is null or p_limite_total not between 1 and 9007199254740991
    or coalesce(p_dia_fechamento,0) not between 1 and 31
    or coalesce(p_dia_vencimento,0) not between 1 and 31 then
    raise exception 'Dados do cartão inválidos.' using errcode='FW400', hint='Informe nome, limite positivo e dias de 1 a 31.';
  end if;
  -- A mesma trava usada pelo motor de compras serializa limite e nova compra.
  perform 1 from public.cartoes_credito
    where id=p_cartao_id and user_id=v_user_id and deleted_at is null for update;
  if not found then
    raise exception 'Cartão não encontrado.' using errcode='FW404', hint='Escolha um cartão ativo da sua conta.';
  end if;
  select coalesce(sum(p.valor),0) into v_comprometido
    from public.parcelas p join public.transacoes_origem t on t.id=p.transacao_id
    where t.cartao_id=p_cartao_id and t.user_id=v_user_id and t.tipo='DESPESA'
      and t.deleted_at is null and p.status='PENDENTE' and p.deleted_at is null;
  if p_limite_total < v_comprometido then
    raise exception 'Limite menor que o crédito comprometido.' using errcode='FW409', hint='Quite as parcelas ou informe um limite maior.';
  end if;
  update public.cartoes_credito set nome=trim(p_nome), limite_total=p_limite_total,
    dia_fechamento=p_dia_fechamento, dia_vencimento=p_dia_vencimento
    where id=p_cartao_id and user_id=v_user_id and deleted_at is null;
  return jsonb_build_object('cartao_id',p_cartao_id);
end;
$$;

create or replace function public.editar_cofrinho(
  p_cofrinho_id uuid, p_nome text, p_valor_alvo bigint, p_horizonte text, p_data_alvo date
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_user_id uuid := auth.uid();
  v_anterior date;
begin
  if v_user_id is null then
    raise exception 'Não autenticado.' using errcode='FW401', hint='Entre novamente.';
  end if;
  if coalesce(length(trim(p_nome)),0) not between 1 and 120
    or p_valor_alvo is null or p_valor_alvo not between 1 and 9007199254740991
    or p_horizonte is null or p_horizonte not in ('CURTO','MEDIO','LONGO') then
    raise exception 'Dados da meta inválidos.' using errcode='FW400', hint='Informe nome, alvo positivo e horizonte válido.';
  end if;
  select data_alvo into v_anterior from public.cofrinhos
    where id=p_cofrinho_id and user_id=v_user_id and deleted_at is null for update;
  if not found then
    raise exception 'Cofrinho não encontrado.' using errcode='FW404', hint='Escolha uma meta ativa da sua conta.';
  end if;
  if p_data_alvo is distinct from v_anterior and p_data_alvo <= (now() at time zone 'America/Sao_Paulo')::date then
    raise exception 'Nova data da meta deve ser futura.' using errcode='FW400', hint='Escolha uma data futura ou deixe sem prazo.';
  end if;
  update public.cofrinhos set nome=trim(p_nome), valor_alvo=p_valor_alvo,
    horizonte=p_horizonte, data_alvo=p_data_alvo
    where id=p_cofrinho_id and user_id=v_user_id and deleted_at is null;
  return jsonb_build_object('cofrinho_id',p_cofrinho_id);
end;
$$;

create or replace function public.editar_recorrencia(
  p_recorrencia_id uuid, p_descricao text, p_valor bigint, p_tipo text,
  p_forma_pagamento text, p_dia_do_mes integer, p_categoria_id uuid
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_user_id uuid := auth.uid();
  v_proxima date;
begin
  if v_user_id is null then
    raise exception 'Não autenticado.' using errcode='FW401', hint='Entre novamente.';
  end if;
  if coalesce(length(trim(p_descricao)),0) not between 1 and 200
    or p_valor is null or p_valor not between 1 and 9007199254740991
    or p_tipo is null or p_tipo not in ('DESPESA','RECEITA')
    or p_forma_pagamento is null or p_forma_pagamento not in ('DEBITO','PIX','DINHEIRO')
    or coalesce(p_dia_do_mes,0) not between 1 and 28 then
    raise exception 'Dados da recorrência inválidos.' using errcode='FW400', hint='Confira descrição, valor, tipo, forma e dia de 1 a 28.';
  end if;
  -- Mesma ordem de trava do aplicador: a ocorrência pendente não muda de mês.
  select proxima_data into v_proxima from public.recorrencias
    where id=p_recorrencia_id and user_id=v_user_id and deleted_at is null for update;
  if not found then
    raise exception 'Recorrência não encontrada.' using errcode='FW404', hint='Escolha uma recorrência ativa da sua conta.';
  end if;
  if p_categoria_id is not null and not exists(select 1 from public.categorias
    where id=p_categoria_id and user_id=v_user_id and deleted_at is null and tipo=p_tipo) then
    raise exception 'Categoria incompatível.' using errcode='FW404', hint='Selecione uma categoria sua e do mesmo tipo.';
  end if;
  update public.recorrencias set descricao=trim(p_descricao), valor=p_valor,
    tipo=p_tipo, forma_pagamento=p_forma_pagamento, dia_do_mes=p_dia_do_mes,
    categoria_id=p_categoria_id,
    proxima_data=make_date(extract(year from v_proxima)::integer,extract(month from v_proxima)::integer,p_dia_do_mes)
    where id=p_recorrencia_id and user_id=v_user_id and deleted_at is null;
  return jsonb_build_object('recorrencia_id',p_recorrencia_id);
end;
$$;

revoke execute on function public.editar_categoria(uuid,text,text,text,bigint,boolean) from public, anon;
revoke execute on function public.editar_cartao(uuid,text,bigint,integer,integer) from public, anon;
revoke execute on function public.editar_cofrinho(uuid,text,bigint,text,date) from public, anon;
revoke execute on function public.editar_recorrencia(uuid,text,bigint,text,text,integer,uuid) from public, anon;
grant execute on function public.editar_categoria(uuid,text,text,text,bigint,boolean) to authenticated;
grant execute on function public.editar_cartao(uuid,text,bigint,integer,integer) to authenticated;
grant execute on function public.editar_cofrinho(uuid,text,bigint,text,date) to authenticated;
grant execute on function public.editar_recorrencia(uuid,text,bigint,text,text,integer,uuid) to authenticated;
