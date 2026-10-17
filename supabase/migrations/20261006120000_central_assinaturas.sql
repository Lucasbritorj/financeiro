-- =====================================================================
-- Central de Assinaturas
--
-- Integra assinaturas à tabela e ao motor já existentes de recorrências.
-- Não cria uma segunda agenda nem materializa transações de assinatura:
-- cobranças no cartão já chegam pela fatura e as demais permanecem como
-- compromisso/projeção explícita. aplicar_recorrencias() continua sendo o
-- único ponto que avança datas vencidas.
-- =====================================================================

alter table public.recorrencias
  alter column forma_pagamento drop not null,
  add column finalidade text not null default 'LANCAMENTO',
  add column periodicidade text,
  add column cartao_id uuid references public.cartoes_credito (id),
  add column cancelada_em timestamptz;

alter table public.recorrencias
  add column status text generated always as (
    case
      when cancelada_em is not null then 'CANCELADA'
      when ativa then 'ATIVA'
      else 'PAUSADA'
    end
  ) stored,
  drop constraint recorrencias_dia_do_mes_check,
  add constraint recorrencias_dia_do_mes_check
    check (
      dia_do_mes between 1 and
        case when finalidade = 'ASSINATURA' then 31 else 28 end
    ),
  add constraint recorrencias_finalidade_check
    check (finalidade in ('LANCAMENTO', 'ASSINATURA')),
  add constraint recorrencias_periodicidade_check
    check (
      periodicidade is null
      or periodicidade in ('MENSAL', 'TRIMESTRAL', 'SEMESTRAL', 'ANUAL')
    ),
  add constraint recorrencias_finalidade_campos_check
    check (
      (
        finalidade = 'LANCAMENTO'
        and periodicidade is null
        and cartao_id is null
        and cancelada_em is null
        and forma_pagamento is not null
        and dia_do_mes is not null
      )
      or
      (
        finalidade = 'ASSINATURA'
        and periodicidade is not null
        and forma_pagamento is null
        and dia_do_mes is not null
      )
    ),
  add constraint recorrencias_cancelamento_check
    check (
      cancelada_em is null
      or (finalidade = 'ASSINATURA' and not ativa)
    );

create index recorrencias_assinaturas_proxima_idx
  on public.recorrencias (user_id, proxima_data)
  where finalidade = 'ASSINATURA'
    and deleted_at is null
    and cancelada_em is null;

-- Avança uma cobrança exatamente um ciclo. A função fica interna: clientes
-- usam somente as RPCs transacionais abaixo.
create or replace function public.fn_avancar_periodicidade(
  p_data date,
  p_periodicidade text,
  p_dia_do_mes integer
)
returns date
language sql
immutable
strict
set search_path = ''
as $$
  with destino as (
    select (
      date_trunc('month', p_data)
      + case p_periodicidade
          when 'MENSAL' then interval '1 month'
          when 'TRIMESTRAL' then interval '3 months'
          when 'SEMESTRAL' then interval '6 months'
          when 'ANUAL' then interval '1 year'
        end
    )::date as inicio_mes
  )
  select inicio_mes + (
    least(
      p_dia_do_mes,
      extract(day from (inicio_mes + interval '1 month - 1 day'))::integer
    ) - 1
  )
  from destino;
$$;

revoke execute on function public.fn_avancar_periodicidade(date, text, integer)
  from public, anon, authenticated;

-- -------------------------- CRUD de assinaturas --------------------------

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

  update public.recorrencias
     set descricao = trim(p_nome),
         valor = p_valor,
         periodicidade = p_periodicidade,
         proxima_data = p_proxima_cobranca,
         dia_do_mes = extract(day from p_proxima_cobranca)::integer,
         categoria_id = p_categoria_id,
         cartao_id = p_cartao_id
   where id = p_assinatura_id
     and user_id = v_user_id
     and finalidade = 'ASSINATURA'
     and cancelada_em is null
     and deleted_at is null;

  if not found then
    raise exception 'Assinatura % não encontrada ou já cancelada.', p_assinatura_id
      using errcode = 'FW404', hint = 'Confira o id e o status da assinatura.';
  end if;

  return jsonb_build_object('assinatura_id', p_assinatura_id, 'editada', true);
end;
$$;

create or replace function public.alterar_status_assinatura(
  p_assinatura_id uuid,
  p_status text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_periodicidade text;
  v_proxima date;
  v_dia_do_mes integer;
  v_cancelada_em timestamptz;
begin
  if v_user_id is null then
    raise exception 'Não autenticado.'
      using errcode = 'FW401', hint = 'Sessão ausente/expirada. Não retente; reautentique.';
  end if;
  if p_status is null or p_status not in ('ATIVA', 'PAUSADA', 'CANCELADA') then
    raise exception 'Status inválido: %', p_status
      using errcode = 'FW400', hint = 'Use ATIVA, PAUSADA ou CANCELADA.';
  end if;

  select periodicidade, proxima_data, dia_do_mes, cancelada_em
    into v_periodicidade, v_proxima, v_dia_do_mes, v_cancelada_em
    from public.recorrencias
   where id = p_assinatura_id
     and user_id = v_user_id
     and finalidade = 'ASSINATURA'
     and deleted_at is null
   for update;

  if not found then
    raise exception 'Assinatura % não encontrada.', p_assinatura_id
      using errcode = 'FW404', hint = 'Confira o id; a assinatura precisa ser sua.';
  end if;

  if v_cancelada_em is not null then
    if p_status = 'CANCELADA' then
      return jsonb_build_object('assinatura_id', p_assinatura_id, 'status', 'CANCELADA');
    end if;
    raise exception 'Assinatura cancelada não pode ser reativada.'
      using errcode = 'FW409', hint = 'Cadastre uma nova assinatura para um novo contrato.';
  end if;

  if p_status = 'ATIVA' then
    while v_proxima < v_hoje loop
      v_proxima := public.fn_avancar_periodicidade(
        v_proxima, v_periodicidade, v_dia_do_mes
      );
    end loop;
    update public.recorrencias
       set ativa = true, proxima_data = v_proxima
     where id = p_assinatura_id;
  elsif p_status = 'PAUSADA' then
    update public.recorrencias
       set ativa = false
     where id = p_assinatura_id;
  else
    update public.recorrencias
       set ativa = false, cancelada_em = now()
     where id = p_assinatura_id;
  end if;

  return jsonb_build_object('assinatura_id', p_assinatura_id, 'status', p_status);
end;
$$;

-- As RPCs legadas continuam limitadas às recorrências que materializam
-- lançamentos. Uma assinatura não pode ser apagada por engano pelo endpoint
-- antigo: cancelamento preserva seu histórico.
create or replace function public.alternar_recorrencia(p_recorrencia_id uuid, p_ativa boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  if v_user_id is null then
    raise exception 'Não autenticado.'
      using errcode = 'FW401', hint = 'Sessão ausente/expirada. Não retente; reautentique.';
  end if;

  update public.recorrencias
     set ativa = p_ativa,
         proxima_data = case
           when p_ativa then public.fn_proxima_ocorrencia(v_hoje, dia_do_mes)
           else proxima_data
         end
   where id = p_recorrencia_id
     and user_id = v_user_id
     and finalidade = 'LANCAMENTO'
     and deleted_at is null;
  if not found then
    raise exception 'Recorrência % não encontrada.', p_recorrencia_id
      using errcode = 'FW404', hint = 'Confira o id; pode ter sido excluída.';
  end if;
  return jsonb_build_object('recorrencia_id', p_recorrencia_id, 'ativa', p_ativa);
end;
$$;

create or replace function public.excluir_recorrencia(p_recorrencia_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'Não autenticado.'
      using errcode = 'FW401', hint = 'Sessão ausente/expirada. Não retente; reautentique.';
  end if;
  update public.recorrencias
     set deleted_at = now()
   where id = p_recorrencia_id
     and user_id = v_user_id
     and finalidade = 'LANCAMENTO'
     and deleted_at is null;
  if not found then
    raise exception 'Recorrência % não encontrada.', p_recorrencia_id
      using errcode = 'FW404', hint = 'Confira o id; pode já ter sido excluída.';
  end if;
  return jsonb_build_object('recorrencia_id', p_recorrencia_id, 'excluida', true);
end;
$$;

-- Único motor de avanço: recorrências comuns continuam materializando pela
-- RPC financeira auditada; assinaturas apenas avançam a agenda. Assim uma
-- assinatura vinculada a cartão nunca duplica a despesa da fatura.
create or replace function public.aplicar_recorrencias()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_rec record;
  v_res jsonb;
  v_tx uuid;
  v_criadas int := 0;
  v_assinaturas_avancadas int := 0;
  v_passos int;
  v_data date;
  v_falhou boolean;
  v_falhas jsonb := '[]'::jsonb;
  v_hint text;
begin
  if v_user_id is null then
    raise exception 'Não autenticado.'
      using errcode = 'FW401', hint = 'Sessão ausente/expirada. Não retente; reautentique.';
  end if;

  for v_rec in
    select *
      from public.recorrencias
     where user_id = v_user_id
       and ativa
       and cancelada_em is null
       and deleted_at is null
       and proxima_data <= v_hoje
     order by proxima_data
     for update
  loop
    v_passos := 0;
    v_data := v_rec.proxima_data;

    if v_rec.finalidade = 'ASSINATURA' then
      while v_data <= v_hoje and v_passos < 12 loop
        v_data := public.fn_avancar_periodicidade(
          v_data, v_rec.periodicidade, v_rec.dia_do_mes
        );
        v_passos := v_passos + 1;
        v_assinaturas_avancadas := v_assinaturas_avancadas + 1;
      end loop;
      update public.recorrencias set proxima_data = v_data where id = v_rec.id;
      continue;
    end if;

    v_falhou := false;
    while v_data <= v_hoje and v_passos < 12 loop
      begin
        v_res := public.processar_transacao_completa(
          v_rec.descricao,
          v_rec.valor,
          v_rec.tipo,
          v_rec.forma_pagamento,
          null,
          v_data,
          1
        );
        v_tx := (v_res->>'transacao_id')::uuid;
        if v_rec.categoria_id is not null then
          perform public.definir_categoria_transacao(
            v_tx,
            v_rec.categoria_id,
            false,
            null
          );
        end if;
        v_criadas := v_criadas + 1;
      exception
        when others then
          get stacked diagnostics v_hint = pg_exception_hint;
          v_falhas := v_falhas || jsonb_build_object(
            'recorrencia_id', v_rec.id,
            'descricao', v_rec.descricao,
            'data_ocorrencia', v_data,
            'sqlstate', sqlstate,
            'mensagem', sqlerrm,
            'hint', v_hint
          );
          v_falhou := true;
      end;
      exit when v_falhou;
      v_passos := v_passos + 1;
      v_data := (date_trunc('month', v_data) + interval '1 month')::date
        + (v_rec.dia_do_mes - 1);
    end loop;
    update public.recorrencias set proxima_data = v_data where id = v_rec.id;
  end loop;

  return jsonb_build_object(
    'transacoes_criadas', v_criadas,
    'assinaturas_avancadas', v_assinaturas_avancadas,
    'falhas', v_falhas,
    'pendentes', exists (
      select 1
        from public.recorrencias
       where user_id = v_user_id
         and ativa
         and cancelada_em is null
         and deleted_at is null
         and proxima_data <= v_hoje
    )
  );
end;
$$;

revoke execute on function public.criar_assinatura(text, bigint, text, date, uuid, uuid)
  from public, anon;
revoke execute on function public.editar_assinatura(uuid, text, bigint, text, date, uuid, uuid)
  from public, anon;
revoke execute on function public.alterar_status_assinatura(uuid, text)
  from public, anon;

grant execute on function public.criar_assinatura(text, bigint, text, date, uuid, uuid)
  to authenticated;
grant execute on function public.editar_assinatura(uuid, text, bigint, text, date, uuid, uuid)
  to authenticated;
grant execute on function public.alterar_status_assinatura(uuid, text)
  to authenticated;
