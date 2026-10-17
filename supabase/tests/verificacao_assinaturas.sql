-- =====================================================================
-- Central de Assinaturas: integração com recorrências, estados, RLS,
-- least privilege e ausência de duplicação de transações/faturas.
-- Executada automaticamente pelo glob de tests/sql/run_asserts.sh.
-- =====================================================================
begin;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000ca', 'assinaturas-a@local.dev'),
  ('00000000-0000-0000-0000-0000000000cb', 'assinaturas-b@local.dev')
on conflict (id) do nothing;

select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000000ca","role":"authenticated"}',
  true
);
set local role authenticated;

do $$
declare
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_cartao uuid;
  v_categoria uuid;
  v_mensal uuid;
  v_anual uuid;
  v_ancorada uuid;
  v_data_ancora date := make_date(extract(year from v_hoje)::integer + 2, 1, 31);
  v_res jsonb;
  v_transacoes_antes bigint;
  v_transacoes_depois bigint;
  v_data_pausada date;
  v_bloqueou boolean;
begin
  v_cartao := (
    public.criar_cartao('Cartão Assinaturas', 500000, 10, 20)->>'cartao_id'
  )::uuid;
  v_categoria := (
    public.criar_categoria('Serviços recorrentes', null, null, 'DESPESA')->>'categoria_id'
  )::uuid;

  select count(*) into v_transacoes_antes
    from public.transacoes_origem
   where deleted_at is null;

  v_res := public.criar_assinatura(
    'Streaming', 4990, 'MENSAL', v_hoje, v_categoria, v_cartao
  );
  v_mensal := (v_res->>'assinatura_id')::uuid;

  -- [ASS-1] Usa a tabela de recorrências existente, centavos inteiros,
  -- categoria/cartão do usuário e status derivado.
  if not exists (
    select 1
      from public.recorrencias
     where id = v_mensal
       and finalidade = 'ASSINATURA'
       and valor = 4990
       and periodicidade = 'MENSAL'
       and categoria_id = v_categoria
       and cartao_id = v_cartao
       and forma_pagamento is null
       and dia_do_mes = extract(day from v_hoje)::integer
       and status = 'ATIVA'
  ) then
    raise exception 'FALHA [ASS-1]: assinatura não integrou recorrencias corretamente';
  end if;

  v_anual := (
    public.criar_assinatura(
      'Nuvem', 12000, 'ANUAL', v_hoje + 1, null, null
    )->>'assinatura_id'
  )::uuid;

  v_ancorada := (
    public.criar_assinatura(
      'Fechamento mensal', 1000, 'MENSAL', v_data_ancora, null, null
    )->>'assinatura_id'
  )::uuid;
  -- [ASS-17] A RPC real aceita e persiste a âncora 29–31 sem ampliar o
  -- limite 1–28 das recorrências que materializam lançamentos.
  if (select dia_do_mes from public.recorrencias where id = v_ancorada) <> 31 then
    raise exception 'FALHA [ASS-17]: assinatura não persistiu âncora no dia 31';
  end if;

  perform public.editar_assinatura(
    v_anual, 'Nuvem Pro', 15000, 'TRIMESTRAL', v_hoje + 10, v_categoria, null
  );
  -- [ASS-2] Edição é atômica e preserva a representação em centavos.
  if not exists (
    select 1 from public.recorrencias
     where id = v_anual
       and descricao = 'Nuvem Pro'
       and valor = 15000
       and periodicidade = 'TRIMESTRAL'
       and proxima_data = v_hoje + 10
       and categoria_id = v_categoria
  ) then
    raise exception 'FALHA [ASS-2]: edição não persistiu todos os campos';
  end if;

  perform public.alterar_status_assinatura(v_mensal, 'PAUSADA');
  select proxima_data into v_data_pausada
    from public.recorrencias where id = v_mensal;
  -- [ASS-3] Pausa é explícita e não apaga o contrato.
  if (select status from public.recorrencias where id = v_mensal) <> 'PAUSADA' then
    raise exception 'FALHA [ASS-3]: assinatura não ficou pausada';
  end if;

  v_res := public.aplicar_recorrencias();
  -- [ASS-4] Pausada não avança nem materializa despesa.
  if (select proxima_data from public.recorrencias where id = v_mensal) <> v_data_pausada
     or (v_res->>'assinaturas_avancadas')::int <> 0 then
    raise exception 'FALHA [ASS-4]: assinatura pausada foi processada: %', v_res;
  end if;

  perform public.alterar_status_assinatura(v_mensal, 'ATIVA');
  v_res := public.aplicar_recorrencias();
  select count(*) into v_transacoes_depois
    from public.transacoes_origem
   where deleted_at is null;
  -- [ASS-5] O motor existente avança a agenda sem duplicar a fatura/transação.
  if (select proxima_data from public.recorrencias where id = v_mensal) <= v_hoje
     or (v_res->>'assinaturas_avancadas')::int <> 1
     or v_transacoes_depois <> v_transacoes_antes then
    raise exception 'FALHA [ASS-5]: avanço ou não-duplicação falhou: %', v_res;
  end if;

  perform public.alterar_status_assinatura(v_anual, 'CANCELADA');
  -- [ASS-6] Cancelamento preserva histórico e produz estado final.
  if not exists (
    select 1 from public.recorrencias
     where id = v_anual and status = 'CANCELADA' and cancelada_em is not null
  ) then
    raise exception 'FALHA [ASS-6]: cancelamento não preservou o registro';
  end if;

  v_bloqueou := false;
  begin
    perform public.alterar_status_assinatura(v_anual, 'ATIVA');
  exception
    when sqlstate 'FW409' then v_bloqueou := true;
  end;
  if not v_bloqueou then
    raise exception 'FALHA [ASS-7]: assinatura cancelada foi reativada';
  end if;

  v_bloqueou := false;
  begin
    perform public.excluir_recorrencia(v_mensal);
  exception
    when sqlstate 'FW404' then v_bloqueou := true;
  end;
  if not v_bloqueou then
    raise exception 'FALHA [ASS-8]: RPC legada apagou uma assinatura';
  end if;

  v_bloqueou := false;
  begin
    perform public.criar_assinatura(
      'Data inválida', 1000, 'MENSAL', v_hoje - 1, null, null
    );
  exception
    when sqlstate 'FW400' then v_bloqueou := true;
  end;
  if not v_bloqueou then
    raise exception 'FALHA [ASS-9]: próxima cobrança passada foi aceita';
  end if;

  if has_table_privilege('authenticated', 'public.recorrencias', 'INSERT')
     or has_table_privilege('authenticated', 'public.recorrencias', 'UPDATE')
     or has_table_privilege('authenticated', 'public.recorrencias', 'DELETE') then
    raise exception 'FALHA [ASS-10]: DML direto foi concedido';
  end if;
  if has_function_privilege(
    'anon',
    'public.criar_assinatura(text,bigint,text,date,uuid,uuid)',
    'EXECUTE'
  ) then
    raise exception 'FALHA [ASS-11]: anon executa criar_assinatura';
  end if;

  perform set_config('teste.assinatura_a', v_mensal::text, true);
  perform set_config('teste.cartao_assinatura_a', v_cartao::text, true);
end $$;

reset role;

select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000000cb","role":"authenticated"}',
  true
);
set local role authenticated;

do $$
declare
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_assinatura_a uuid := current_setting('teste.assinatura_a')::uuid;
  v_cartao_a uuid := current_setting('teste.cartao_assinatura_a')::uuid;
  v_bloqueou boolean;
begin
  -- [ASS-12] A policy existente isola a extensão entre usuários.
  if (select count(*) from public.recorrencias where id = v_assinatura_a) <> 0 then
    raise exception 'FALHA [ASS-12]: usuário B enxerga assinatura de A';
  end if;

  v_bloqueou := false;
  begin
    perform public.criar_assinatura(
      'Cartão alheio', 1000, 'MENSAL', v_hoje + 1, null, v_cartao_a
    );
  exception
    when sqlstate 'FW404' then v_bloqueou := true;
  end;
  if not v_bloqueou then
    raise exception 'FALHA [ASS-13]: usuário B vinculou cartão de A';
  end if;

  v_bloqueou := false;
  begin
    perform public.editar_assinatura(
      v_assinatura_a, 'Ataque', 1000, 'MENSAL', v_hoje + 1, null, null
    );
  exception
    when sqlstate 'FW404' then v_bloqueou := true;
  end;
  if not v_bloqueou then
    raise exception 'FALHA [ASS-14]: usuário B editou assinatura de A';
  end if;

  v_bloqueou := false;
  begin
    perform public.alterar_status_assinatura(v_assinatura_a, 'CANCELADA');
  exception
    when sqlstate 'FW404' then v_bloqueou := true;
  end;
  if not v_bloqueou then
    raise exception 'FALHA [ASS-15]: usuário B cancelou assinatura de A';
  end if;

  if not has_function_privilege(
    'authenticated',
    'public.criar_assinatura(text,bigint,text,date,uuid,uuid)',
    'EXECUTE'
  ) then
    raise exception 'FALHA [ASS-16]: authenticated não executa criar_assinatura';
  end if;

end $$;

reset role;

do $$
begin
  -- [ASS-18] A âncora do dia sobrevive ao encurtamento de fevereiro.
  if public.fn_avancar_periodicidade(date '2026-01-31', 'MENSAL', 31)
       <> date '2026-02-28'
     or public.fn_avancar_periodicidade(date '2026-02-28', 'MENSAL', 31)
       <> date '2026-03-31'
      or public.fn_avancar_periodicidade(date '2027-02-28', 'ANUAL', 29)
       <> date '2028-02-29' then
    raise exception 'FALHA [ASS-18]: avanço perdeu a âncora do dia 29–31';
  end if;

end $$;

-- [ASS-19] RPC real: 31/01 -> 28/02, edição só de valor, próximo avanço 31/03.
-- 2031 não é bissexto. O UPDATE da data clampada simula o estado que o motor
-- já teria gravado; a edição e a preservação da âncora são da RPC.
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000000ca","role":"authenticated"}',
  true
);
set local role authenticated;

do $$
declare
  v_id uuid;
begin
  v_id := (
    public.criar_assinatura(
      'Ancora jan', 1000, 'MENSAL', date '2031-01-31', null, null
    )->>'assinatura_id'
  )::uuid;
  if (select dia_do_mes from public.recorrencias where id = v_id) <> 31 then
    raise exception 'FALHA [ASS-19]: criar não persistiu dia 31';
  end if;
  perform set_config('teste.ancora_id', v_id::text, true);
end $$;

reset role;

update public.recorrencias
   set proxima_data = public.fn_avancar_periodicidade(date '2031-01-31', 'MENSAL', 31)
 where id = current_setting('teste.ancora_id')::uuid;

select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000000ca","role":"authenticated"}',
  true
);
set local role authenticated;

do $$
declare
  v_id uuid := current_setting('teste.ancora_id')::uuid;
begin
  if (select proxima_data from public.recorrencias where id = v_id) <> date '2031-02-28' then
    raise exception 'FALHA [ASS-19]: 31/01 não avançou para 28/02';
  end if;

  perform public.editar_assinatura(
    v_id, 'Ancora jan', 2500, 'MENSAL', date '2031-02-28', null, null
  );
  if not exists (
    select 1 from public.recorrencias
     where id = v_id
       and valor = 2500
       and dia_do_mes = 31
       and proxima_data = date '2031-02-28'
  ) then
    raise exception 'FALHA [ASS-19]: edição de valor regravou a âncora';
  end if;
end $$;

reset role;

do $$
declare
  v_id uuid := current_setting('teste.ancora_id')::uuid;
  v_dia integer;
  v_proxima date;
begin
  select dia_do_mes, proxima_data into v_dia, v_proxima
    from public.recorrencias where id = v_id;
  if public.fn_avancar_periodicidade(v_proxima, 'MENSAL', v_dia) <> date '2031-03-31' then
    raise exception 'FALHA [ASS-19]: próximo avanço não caiu em 31/03';
  end if;
end $$;

select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000000ca","role":"authenticated"}',
  true
);
set local role authenticated;

do $$
declare
  v_id uuid := current_setting('teste.ancora_id')::uuid;
  v_bloqueou boolean;
  v_cartao uuid;
  v_vinculada uuid;
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_teto uuid;
begin
  -- [ASS-20] Mudança real de data reancora; data vencida inalterada não.
  perform public.editar_assinatura(
    v_id, 'Ancora jan', 2500, 'MENSAL', date '2031-04-15', null, null
  );
  if (select dia_do_mes from public.recorrencias where id = v_id) <> 15 then
    raise exception 'FALHA [ASS-20]: mudança real de data não atualizou a âncora';
  end if;

  -- [ASS-21] Excluir cartão desvincula e a assinatura continua editável.
  v_cartao := (public.criar_cartao('Cartão a excluir', 100000, 5, 15)->>'cartao_id')::uuid;
  v_vinculada := (
    public.criar_assinatura(
      'Vinculada', 2000, 'MENSAL', v_hoje + 4, null, v_cartao
    )->>'assinatura_id'
  )::uuid;
  perform public.excluir_cartao(v_cartao);
  if exists (
    select 1 from public.recorrencias
     where id = v_vinculada and cartao_id is not null
  ) then
    raise exception 'FALHA [ASS-21]: exclusão deixou cartao_id preso';
  end if;
  perform public.editar_assinatura(
    v_vinculada, 'Vinculada', 2100, 'MENSAL', v_hoje + 4, null, null
  );
  if not exists (
    select 1 from public.recorrencias
     where id = v_vinculada and valor = 2100 and cartao_id is null
  ) then
    raise exception 'FALHA [ASS-21]: assinatura ficou ineditável após exclusão do cartão';
  end if;

  -- [ASS-22] Teto de 0017: limite aceito, acima rejeitado na criação e na edição.
  v_teto := (
    public.criar_assinatura(
      'No teto', 999999999999, 'MENSAL', v_hoje + 5, null, null
    )->>'assinatura_id'
  )::uuid;
  perform public.editar_assinatura(
    v_teto, 'No teto', 999999999999, 'MENSAL', v_hoje + 5, null, null
  );
  v_bloqueou := false;
  begin
    perform public.criar_assinatura(
      'Acima', 1000000000000, 'MENSAL', v_hoje + 6, null, null
    );
  exception
    when sqlstate 'FW400' then v_bloqueou := true;
  end;
  if not v_bloqueou then
    raise exception 'FALHA [ASS-22]: criação acima do teto foi aceita';
  end if;
  v_bloqueou := false;
  begin
    perform public.editar_assinatura(
      v_teto, 'No teto', 1000000000000, 'MENSAL', v_hoje + 5, null, null
    );
  exception
    when sqlstate 'FW400' then v_bloqueou := true;
  end;
  if not v_bloqueou
     or (select valor from public.recorrencias where id = v_teto) <> 999999999999 then
    raise exception 'FALHA [ASS-22]: edição acima do teto foi aceita';
  end if;
end $$;

reset role;

do $$
declare
  v_id uuid := current_setting('teste.ancora_id')::uuid;
begin
  update public.recorrencias
     set proxima_data = date '2020-01-31',
         dia_do_mes = 31
   where id = v_id;
end $$;

select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000000ca","role":"authenticated"}',
  true
);
set local role authenticated;

do $$
declare
  v_id uuid := current_setting('teste.ancora_id')::uuid;
begin
  perform public.editar_assinatura(
    v_id, 'Ancora vencida', 2600, 'MENSAL', date '2020-01-31', null, null
  );
  if not exists (
    select 1 from public.recorrencias
     where id = v_id and valor = 2600 and dia_do_mes = 31 and proxima_data = date '2020-01-31'
  ) then
    raise exception 'FALHA [ASS-20]: data vencida inalterada reancorou dia_do_mes';
  end if;
end $$;

reset role;

do $$
begin
  raise notice 'OK: 22/22 asserts da Central de Assinaturas passaram.';
end $$;

rollback;
