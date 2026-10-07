-- =====================================================================
-- Correções da Central de Assinaturas.
-- Append-only, no padrão de 0019: não reescreve migrations anteriores.
--   1. editar_assinatura preserva dia_do_mes quando a data enviada é a
--      já persistida (mês curto ou vencida). Só reancora se a próxima
--      cobrança mudou de fato, e essa data nova não pode estar no passado.
--   2. excluir_cartao desvincula recorrencias.cartao_id, como
--      excluir_categoria já faz com categoria_id (0019).
--   3. teto de recorrencias.valor, o mesmo de 0017.
-- =====================================================================

alter table public.recorrencias
  drop constraint if exists recorrencias_valor_teto;
alter table public.recorrencias
  add constraint recorrencias_valor_teto
  check (valor <= 999999999999);

-- Cartões já soft-deleted não podem continuar como FK lógica.
update public.recorrencias r
   set cartao_id = null
  from public.cartoes_credito c
 where r.cartao_id = c.id
   and c.deleted_at is not null;

create or replace function public.criar_assinatura(
  p_nome text,
  p_valor bigint,
  p_periodicidade text,
  p_proxima_cobranca date,
  p_categoria_id uuid default null,
  p_cartao_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_id uuid;
begin
  if v_user_id is null then
    raise exception 'Não autenticado.'
      using errcode = 'FW401', hint = 'Sessão ausente/expirada. Não retente; reautentique.';
  end if;
  if coalesce(trim(p_nome), '') = '' then
    raise exception 'Nome da assinatura obrigatório.'
      using errcode = 'FW400', hint = 'Informe o serviço contratado.';
  end if;
  if p_valor is null or p_valor <= 0 then
    raise exception 'Valor deve ser positivo em centavos.'
      using errcode = 'FW400', hint = 'Envie centavos (inteiro > 0).';
  end if;
  if p_valor > 999999999999 then
    raise exception 'Valor acima do teto de centavos.'
      using errcode = 'FW400', hint = 'O máximo é 999999999999 centavos.';
  end if;
  if p_periodicidade is null
     or p_periodicidade not in ('MENSAL', 'TRIMESTRAL', 'SEMESTRAL', 'ANUAL') then
    raise exception 'Periodicidade inválida: %', p_periodicidade
      using errcode = 'FW400',
            hint = 'Use MENSAL, TRIMESTRAL, SEMESTRAL ou ANUAL.';
  end if;
  if p_proxima_cobranca is null or p_proxima_cobranca < v_hoje then
    raise exception 'Próxima cobrança não pode estar no passado.'
      using errcode = 'FW400', hint = 'Informe hoje ou uma data futura.';
  end if;
  if p_categoria_id is not null and not exists (
    select 1
      from public.categorias
     where id = p_categoria_id
       and user_id = v_user_id
       and tipo = 'DESPESA'
       and deleted_at is null
  ) then
    raise exception 'Categoria % inexistente ou incompatível.', p_categoria_id
      using errcode = 'FW404', hint = 'A categoria precisa ser uma despesa sua.';
  end if;
  if p_cartao_id is not null and not exists (
    select 1
      from public.cartoes_credito
     where id = p_cartao_id
       and user_id = v_user_id
       and deleted_at is null
  ) then
    raise exception 'Cartão % não encontrado.', p_cartao_id
      using errcode = 'FW404', hint = 'O cartão precisa ser seu e estar ativo.';
  end if;

  insert into public.recorrencias (
    user_id, descricao, valor, tipo, forma_pagamento, categoria_id,
    dia_do_mes, proxima_data, ativa, finalidade, periodicidade, cartao_id
  )
  values (
    v_user_id, trim(p_nome), p_valor, 'DESPESA', null, p_categoria_id,
    extract(day from p_proxima_cobranca)::integer,
    p_proxima_cobranca, true, 'ASSINATURA', p_periodicidade, p_cartao_id
  )
  returning id into v_id;

  return jsonb_build_object(
    'assinatura_id', v_id,
    'status', 'ATIVA',
    'proxima_cobranca', p_proxima_cobranca
  );
end;
$$;

create or replace function public.editar_assinatura(
  p_assinatura_id uuid,
  p_nome text,
  p_valor bigint,
  p_periodicidade text,
  p_proxima_cobranca date,
  p_categoria_id uuid default null,
  p_cartao_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_proxima date;
  v_dia integer;
  v_dia_novo integer;
  v_mudou_data boolean;
begin
  if v_user_id is null then
    raise exception 'Não autenticado.'
      using errcode = 'FW401', hint = 'Sessão ausente/expirada. Não retente; reautentique.';
  end if;
  if coalesce(trim(p_nome), '') = '' then
    raise exception 'Nome da assinatura obrigatório.'
      using errcode = 'FW400', hint = 'Informe o serviço contratado.';
  end if;
  if p_valor is null or p_valor <= 0 then
    raise exception 'Valor deve ser positivo em centavos.'
      using errcode = 'FW400', hint = 'Envie centavos (inteiro > 0).';
  end if;
  if p_valor > 999999999999 then
    raise exception 'Valor acima do teto de centavos.'
      using errcode = 'FW400', hint = 'O máximo é 999999999999 centavos.';
  end if;
  if p_periodicidade is null
     or p_periodicidade not in ('MENSAL', 'TRIMESTRAL', 'SEMESTRAL', 'ANUAL') then
    raise exception 'Periodicidade inválida: %', p_periodicidade
      using errcode = 'FW400',
            hint = 'Use MENSAL, TRIMESTRAL, SEMESTRAL ou ANUAL.';
  end if;
  if p_proxima_cobranca is null then
    raise exception 'Próxima cobrança é obrigatória.'
      using errcode = 'FW400', hint = 'Informe a data da próxima cobrança.';
  end if;

  select proxima_data, dia_do_mes
    into v_proxima, v_dia
    from public.recorrencias
   where id = p_assinatura_id
     and user_id = v_user_id
     and finalidade = 'ASSINATURA'
     and cancelada_em is null
     and deleted_at is null
   for update;

  if not found then
    raise exception 'Assinatura % não encontrada ou já cancelada.', p_assinatura_id
      using errcode = 'FW404', hint = 'Confira o id e o status da assinatura.';
  end if;

  -- Data igual à persistida não é mudança de agenda: mês curto já clampado
  -- ou data vencida não podem reancorar dia_do_mes.
  v_mudou_data := p_proxima_cobranca is distinct from v_proxima;
  if v_mudou_data then
    if p_proxima_cobranca < v_hoje then
      raise exception 'Próxima cobrança não pode estar no passado.'
        using errcode = 'FW400', hint = 'Informe hoje ou uma data futura.';
    end if;
    v_dia_novo := extract(day from p_proxima_cobranca)::integer;
  else
    v_dia_novo := v_dia;
  end if;

  if p_categoria_id is not null and not exists (
    select 1
      from public.categorias
     where id = p_categoria_id
       and user_id = v_user_id
       and tipo = 'DESPESA'
       and deleted_at is null
  ) then
    raise exception 'Categoria % inexistente ou incompatível.', p_categoria_id
      using errcode = 'FW404', hint = 'A categoria precisa ser uma despesa sua.';
  end if;
  if p_cartao_id is not null and not exists (
    select 1
      from public.cartoes_credito
     where id = p_cartao_id
       and user_id = v_user_id
       and deleted_at is null
  ) then
    raise exception 'Cartão % não encontrado.', p_cartao_id
      using errcode = 'FW404', hint = 'O cartão precisa ser seu e estar ativo.';
  end if;

  update public.recorrencias
     set descricao = trim(p_nome),
         valor = p_valor,
         periodicidade = p_periodicidade,
         proxima_data = p_proxima_cobranca,
         dia_do_mes = v_dia_novo,
         categoria_id = p_categoria_id,
         cartao_id = p_cartao_id
   where id = p_assinatura_id
     and user_id = v_user_id
     and finalidade = 'ASSINATURA'
     and cancelada_em is null
     and deleted_at is null;

  return jsonb_build_object(
    'assinatura_id', p_assinatura_id,
    'editada', true,
    'dia_do_mes', v_dia_novo
  );
end;
$$;

create or replace function public.excluir_cartao(p_cartao_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_cartao public.cartoes_credito%rowtype;
  v_assinaturas int;
begin
  if v_user_id is null then
    raise exception 'Não autenticado.'
      using errcode = 'FW401', hint = 'Sessão ausente/expirada. Não retente; reautentique.';
  end if;
  if p_cartao_id is null then
    raise exception 'p_cartao_id é obrigatório.'
      using errcode = 'FW400', hint = 'Informe o uuid do cartão.';
  end if;

  select * into v_cartao
  from public.cartoes_credito
  where id = p_cartao_id and user_id = v_user_id and deleted_at is null
  for update;
  if not found then
    raise exception 'Cartão % não encontrado para este usuário.', p_cartao_id
      using errcode = 'FW404', hint = 'Confira o id; o cartão pode já estar excluído.';
  end if;

  if exists (select 1
             from public.parcelas p
             join public.transacoes_origem t on t.id = p.transacao_id
             where t.cartao_id = v_cartao.id
               and t.user_id = v_user_id
               and p.status = 'PENDENTE'
               and p.deleted_at is null
               and t.deleted_at is null) then
    raise exception 'Cartão % tem parcelas pendentes — quite as faturas antes de excluí-lo.', p_cartao_id
      using errcode = 'FW409', hint = 'Pague as faturas em aberto ou exclua as transações pendentes.';
  end if;

  update public.cartoes_credito
     set deleted_at = now()
   where id = v_cartao.id;

  -- Mesmo precedente de excluir_categoria (0019): a assinatura continua,
  -- só perde o vínculo explícito. Sem isto, editar_assinatura rejeita o
  -- cartão soft-deleted e a linha fica ineditável.
  update public.recorrencias
     set cartao_id = null
   where cartao_id = v_cartao.id
     and user_id = v_user_id
     and deleted_at is null;
  get diagnostics v_assinaturas = row_count;

  return jsonb_build_object(
    'cartao_id', v_cartao.id,
    'assinaturas_afetadas', v_assinaturas
  );
end;
$$;
