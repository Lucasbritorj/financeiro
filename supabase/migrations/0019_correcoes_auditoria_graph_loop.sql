-- =====================================================================
-- 0019_correcoes_auditoria_graph_loop.sql
-- Correções da auditoria graph-loop (2026-07-27) sobre a camada
-- Postgres/Supabase. Idempotente (create or replace / alter column set
-- default). Não edita 0001-0018 no lugar — toda correção de função é
-- `create or replace` aqui, redefinindo o corpo inteiro (histórico de
-- migration é append-only; é assim que este projeto já corrigiu
-- criar_importacao duas vezes, em 0016 e 0018).
--
--   S-01 (alto) excluir_categoria não desvinculava recorrencias.categoria_id
--   (só regras_categorizacao); aplicar_recorrencias chamava
--   definir_categoria_transacao dentro do loop sem bloco exception, então
--   um FW404 numa recorrência abortava a transação inteira — nenhuma
--   recorrência materializava, mesmo as sem relação com a categoria
--   excluída. Corrigido nas duas pontas nesta seção.
--
-- (S-04, S-06, S-05, ver seções seguintes desta mesma migration.)
-- =====================================================================

-- ---------------------------------------------------------------------
-- S-01 (a) — excluir_categoria também desvincula recorrencias.
-- Espelha o que já fazia com regras_categorizacao: a recorrência CONTINUA
-- ativa (excluir uma categoria não é motivo para desligar a recorrência),
-- só perde a categoria explícita — na próxima materialização, o trigger
-- de autocategorização (0008) decide de novo a partir da descrição, como
-- qualquer lançamento sem categoria.
-- ---------------------------------------------------------------------
create or replace function public.excluir_categoria(p_categoria_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_regras int;
  v_recorrencias int;
begin
  if v_user_id is null then
    raise exception 'Não autenticado.'
      using errcode = 'FW401', hint = 'Sessão ausente/expirada. Não retente; reautentique.';
  end if;

  update public.categorias
     set deleted_at = now()
   where id = p_categoria_id and user_id = v_user_id and deleted_at is null;
  if not found then
    raise exception 'Categoria % não encontrada para este usuário.', p_categoria_id
      using errcode = 'FW404', hint = 'Confira o id; a categoria pode já estar excluída.';
  end if;

  update public.regras_categorizacao
     set deleted_at = now()
   where categoria_id = p_categoria_id and user_id = v_user_id and deleted_at is null;
  get diagnostics v_regras = row_count;

  -- S-01: sem isto, recorrencias.categoria_id ficava apontando para uma
  -- categoria excluída, e aplicar_recorrencias (abaixo) tentava aplicar
  -- essa categoria morta a cada materialização — FW404 de
  -- definir_categoria_transacao que, pré-fix, derrubava a chamada inteira.
  update public.recorrencias
     set categoria_id = null
   where categoria_id = p_categoria_id and user_id = v_user_id and deleted_at is null;
  get diagnostics v_recorrencias = row_count;

  return jsonb_build_object(
    'categoria_id', p_categoria_id,
    'regras_afetadas', v_regras,
    'recorrencias_afetadas', v_recorrencias);
end;
$$;

-- ---------------------------------------------------------------------
-- S-01 (b) — aplicar_recorrencias isola falha por ocorrência.
-- Antes: a chamada a definir_categoria_transacao ficava dentro do loop
-- sem bloco EXCEPTION — qualquer erro (FW404 de categoria órfã ou
-- qualquer outra causa) propagava para fora da função e abortava a
-- transação INTEIRA da RPC, revertendo inclusive recorrências já
-- materializadas nesta mesma chamada e impedindo as seguintes, mesmo sem
-- nenhuma relação com o erro. Como aplicar_recorrencias roda a cada
-- carregamento do dashboard, isso travava o usuário indefinidamente após
-- uma ação normal dele (excluir uma categoria usada por alguma
-- recorrência).
--
-- Depois: cada OCORRÊNCIA roda num bloco BEGIN/EXCEPTION próprio.
-- PL/pgSQL implementa EXCEPTION com um SAVEPOINT implícito por bloco: um
-- erro desfaz só os efeitos daquela ocorrência (a transação criada por
-- processar_transacao_completa e a categorização ficam atômicas entre
-- si — nunca sobra transação "meio aplicada" sem a categoria certa) e as
-- demais ocorrências/recorrências seguem. A falha é registrada em
-- `falhas` (jsonb) no retorno em vez de estourar pro chamador.
-- proxima_data NÃO avança sobre a ocorrência que falhou — a próxima
-- chamada retenta a partir dali (self-healing quando a causa, ex.:
-- categoria órfã, for corrigida — inclusive pelo fix (a) acima).
--
-- Granularidade por OCORRÊNCIA (não por recorrência inteira, com um único
-- bloco por v_rec envolvendo todo o while) é proposital: variáveis
-- PL/pgSQL (ex.: v_criadas) NÃO são desfeitas por ROLLBACK TO SAVEPOINT —
-- só efeitos no banco são. Se o bloco EXCEPTION envolvesse várias
-- ocorrências da mesma recorrência, uma falha na 2ª ocorrência reverteria
-- no banco a 1ª (já bem-sucedida) mas v_criadas continuaria contando as
-- duas, dessincronizando o retorno da realidade. Um bloco por ocorrência
-- evita essa inconsistência.
-- ---------------------------------------------------------------------
create or replace function public.aplicar_recorrencias()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_hoje    date := (now() at time zone 'America/Sao_Paulo')::date;
  v_rec     record;
  v_res     jsonb;
  v_tx      uuid;
  v_criadas int := 0;
  v_passos  int;
  v_data    date;
  v_falhou  boolean;
  v_falhas  jsonb := '[]'::jsonb;
  v_hint    text;
begin
  if v_user_id is null then
    raise exception 'Não autenticado.'
      using errcode = 'FW401', hint = 'Sessão ausente/expirada. Não retente; reautentique.';
  end if;

  for v_rec in
    select * from public.recorrencias
     where user_id = v_user_id and ativa and deleted_at is null and proxima_data <= v_hoje
     order by proxima_data
     for update
  loop
    v_passos := 0;
    v_data   := v_rec.proxima_data;
    v_falhou := false;
    while v_data <= v_hoje and v_passos < 12 loop
      begin
        v_res := public.processar_transacao_completa(
          v_rec.descricao, v_rec.valor, v_rec.tipo, v_rec.forma_pagamento,
          null, v_data, 1
        );
        v_tx := (v_res->>'transacao_id')::uuid;
        if v_rec.categoria_id is not null then
          perform public.definir_categoria_transacao(v_tx, v_rec.categoria_id, false, null);
        end if;
        v_criadas := v_criadas + 1;
      exception
        when others then
          get stacked diagnostics v_hint = pg_exception_hint;
          v_falhas := v_falhas || jsonb_build_object(
            'recorrencia_id',  v_rec.id,
            'descricao',       v_rec.descricao,
            'data_ocorrencia', v_data,
            'sqlstate',        sqlstate,
            'mensagem',        sqlerrm,
            'hint',            v_hint
          );
          v_falhou := true;
      end;
      exit when v_falhou;
      v_passos := v_passos + 1;
      v_data    := (date_trunc('month', v_data) + interval '1 month')::date + (v_rec.dia_do_mes - 1);
    end loop;
    -- Sem falha: v_data é a próxima ocorrência ainda não vencida (ou já
    -- passou de 12 passos). Com falha: v_data ficou na ocorrência que
    -- falhou (exit saiu antes do avanço) — próxima chamada retenta dali.
    update public.recorrencias set proxima_data = v_data where id = v_rec.id;
  end loop;

  return jsonb_build_object(
    'transacoes_criadas', v_criadas,
    'falhas', v_falhas,
    'pendentes', exists (
      select 1 from public.recorrencias
       where user_id = v_user_id and ativa and deleted_at is null and proxima_data <= v_hoje
    )
  );
end;
$$;

-- =====================================================================
-- S-04 (médio) — janela de competência dos boletos alinhada a +5 anos.
-- criar_boleto/editar_boleto (0013) e duplicar_boleto (0014) aceitam
-- vencimento até +5 anos, mas revalidavam a competência DERIVADA do
-- vencimento (default = 1º dia do mês do vencimento, quando
-- p_data_competencia vem nula) contra um teto de só +1 ano — um boleto
-- legítimo com vencimento em 18 meses, sem competência explícita, era
-- rejeitado com FW400 citando "competência", campo que o chamador sequer
-- tocou. Corpo idêntico ao original em cada função; só o teto da
-- competência muda de +1 year para +5 years (igual ao do vencimento, já
-- que a competência default É o vencimento truncado ao mês — não faz
-- sentido um teto mais apertado que o campo do qual ela deriva).
-- =====================================================================
create or replace function public.criar_boleto(
  p_descricao        text,
  p_valor            bigint,             -- centavos
  p_data_vencimento  date,
  p_data_competencia date default null,  -- null = 1º dia do mês do vencimento
  p_categoria_id     uuid default null   -- null = trigger 0008 autocategoriza
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id      uuid := auth.uid();
  v_comp         date;
  v_transacao_id uuid;
begin
  if v_user_id is null then
    raise exception 'Não autenticado.'
      using errcode = 'FW401', hint = 'Sessão ausente/expirada. Não retente; reautentique.';
  end if;
  if coalesce(trim(p_descricao), '') = '' then
    raise exception 'descricao é obrigatória.'
      using errcode = 'FW400', hint = 'Informe uma descrição e chame novamente.';
  end if;
  if p_valor is null or p_valor <= 0 then
    raise exception 'valor deve ser positivo, em centavos. Recebido: %', p_valor
      using errcode = 'FW400', hint = 'Envie o valor em centavos (inteiro > 0).';
  end if;
  if p_data_vencimento is null then
    raise exception 'data_vencimento é obrigatória para boleto.'
      using errcode = 'FW400', hint = 'Informe a data de vencimento.';
  end if;
  -- Vencimento plausível: atrasado (passado) ok; futuro até 5 anos.
  if p_data_vencimento < date '2000-01-01'
     or p_data_vencimento > (now() at time zone 'America/Sao_Paulo')::date + interval '5 years' then
    raise exception 'data_vencimento fora do intervalo plausível: %', p_data_vencimento
      using errcode = 'FW400', hint = 'Use uma data entre 2000-01-01 e +5 anos.';
  end if;

  -- Competência: default = mês do vencimento. S-04: teto alinhado a +5
  -- anos (igual ao vencimento) — era +1 ano e rejeitava competência
  -- DERIVADA (não escolhida pelo chamador) de um vencimento distante mas
  -- válido.
  v_comp := coalesce(p_data_competencia, date_trunc('month', p_data_vencimento)::date);
  if v_comp < date '2000-01-01'
     or v_comp > (now() at time zone 'America/Sao_Paulo')::date + interval '5 years' then
    raise exception 'competência fora do intervalo plausível: %', v_comp
      using errcode = 'FW400', hint = 'Use uma competência entre 2000-01-01 e +5 anos.';
  end if;

  -- Categoria explícita, se veio, precisa ser do usuário.
  if p_categoria_id is not null and not exists (
      select 1 from public.categorias
      where id = p_categoria_id and user_id = v_user_id and deleted_at is null) then
    raise exception 'Categoria % não encontrada para este usuário.', p_categoria_id
      using errcode = 'FW404', hint = 'Confira o id da categoria.';
  end if;

  insert into public.transacoes_origem
    (user_id, descricao, valor_total, tipo, forma_pagamento, cartao_id,
     data_compra, num_parcelas, data_vencimento, categoria_id)
  values
    (v_user_id, trim(p_descricao), p_valor, 'DESPESA', 'BOLETO', null,
     v_comp, 1, p_data_vencimento, p_categoria_id)   -- trigger autocategoriza se null
  returning id into v_transacao_id;

  -- Parcela única: PENDENTE = "a pagar". data_competencia = competência.
  insert into public.parcelas
    (user_id, transacao_id, fatura_id, numero, valor, data_competencia)
  values
    (v_user_id, v_transacao_id, null, 1, p_valor, v_comp);

  return jsonb_build_object(
    'transacao_id',   v_transacao_id,
    'data_vencimento', p_data_vencimento,
    'competencia',    v_comp,
    'status',         'A_PAGAR');
end;
$$;

create or replace function public.editar_boleto(
  p_transacao_id     uuid,
  p_descricao        text   default null,   -- null = mantém
  p_valor            bigint default null,   -- centavos; null = mantém
  p_data_vencimento  date   default null,   -- null = mantém
  p_data_competencia date   default null,   -- null = mantém
  p_categoria_id     uuid   default null,   -- null = mantém
  p_alterar_categoria boolean default false -- true = aplica p_categoria_id (inclusive null p/ remover)
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_t       public.transacoes_origem%rowtype;
  v_desc    text;
  v_valor   bigint;
  v_venc    date;
  v_comp    date;
begin
  if v_user_id is null then
    raise exception 'Não autenticado.'
      using errcode = 'FW401', hint = 'Sessão ausente/expirada. Não retente; reautentique.';
  end if;
  if p_transacao_id is null then
    raise exception 'p_transacao_id é obrigatório.'
      using errcode = 'FW400', hint = 'Informe o uuid do boleto.';
  end if;

  select * into v_t
  from public.transacoes_origem
  where id = p_transacao_id and user_id = v_user_id and deleted_at is null
    and forma_pagamento = 'BOLETO'
  for update;
  if not found then
    raise exception 'Boleto % não encontrado para este usuário.', p_transacao_id
      using errcode = 'FW404', hint = 'Confira o id; o boleto pode estar excluído ou não ser BOLETO.';
  end if;

  if exists (select 1 from public.parcelas
             where transacao_id = v_t.id and user_id = v_user_id
               and status = 'PAGA' and deleted_at is null) then
    raise exception 'Boleto % já está PAGO — não pode ser editado.', p_transacao_id
      using errcode = 'FW409', hint = 'Histórico pago não se edita.';
  end if;

  v_desc  := coalesce(nullif(trim(coalesce(p_descricao, '')), ''), v_t.descricao);
  v_valor := coalesce(p_valor, v_t.valor_total);
  v_venc  := coalesce(p_data_vencimento, v_t.data_vencimento);
  v_comp  := coalesce(p_data_competencia, v_t.data_compra);

  if v_valor <= 0 then
    raise exception 'valor deve ser positivo, em centavos. Recebido: %', v_valor
      using errcode = 'FW400', hint = 'Envie o valor em centavos (inteiro > 0).';
  end if;
  if v_venc < date '2000-01-01'
     or v_venc > (now() at time zone 'America/Sao_Paulo')::date + interval '5 years' then
    raise exception 'data_vencimento fora do intervalo plausível: %', v_venc
      using errcode = 'FW400', hint = 'Use uma data entre 2000-01-01 e +5 anos.';
  end if;
  -- S-04: teto da competência alinhado a +5 anos (era +1 ano).
  if v_comp < date '2000-01-01'
     or v_comp > (now() at time zone 'America/Sao_Paulo')::date + interval '5 years' then
    raise exception 'competência fora do intervalo plausível: %', v_comp
      using errcode = 'FW400', hint = 'Use uma competência entre 2000-01-01 e +5 anos.';
  end if;
  if p_alterar_categoria and p_categoria_id is not null and not exists (
      select 1 from public.categorias
      where id = p_categoria_id and user_id = v_user_id and deleted_at is null) then
    raise exception 'Categoria % não encontrada para este usuário.', p_categoria_id
      using errcode = 'FW404', hint = 'Confira o id da categoria.';
  end if;

  update public.transacoes_origem
     set descricao       = v_desc,
         valor_total     = v_valor,
         data_vencimento = v_venc,
         data_compra     = v_comp,
         categoria_id    = case when p_alterar_categoria then p_categoria_id else categoria_id end
   where id = v_t.id;

  -- Parcela única acompanha valor e competência.
  update public.parcelas
     set valor = v_valor,
         data_competencia = v_comp
   where transacao_id = v_t.id and user_id = v_user_id and deleted_at is null;

  return jsonb_build_object('transacao_id', v_t.id);
end;
$$;

create or replace function public.duplicar_boleto(
  p_transacao_id uuid,
  p_meses        int default 1   -- quantos meses à frente (1 = próximo mês)
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id      uuid := auth.uid();
  v_src          public.transacoes_origem%rowtype;
  v_venc         date;
  v_comp         date;
  v_novo_id      uuid;
begin
  if v_user_id is null then
    raise exception 'Não autenticado.'
      using errcode = 'FW401', hint = 'Sessão ausente/expirada. Não retente; reautentique.';
  end if;
  if p_transacao_id is null then
    raise exception 'p_transacao_id é obrigatório.'
      using errcode = 'FW400', hint = 'Informe o uuid do boleto de origem.';
  end if;
  if p_meses is null or p_meses < 1 or p_meses > 12 then
    raise exception 'p_meses deve estar entre 1 e 12. Recebido: %', p_meses
      using errcode = 'FW400', hint = 'Use um deslocamento de 1 a 12 meses.';
  end if;

  select * into v_src
  from public.transacoes_origem
  where id = p_transacao_id and user_id = v_user_id and deleted_at is null
    and forma_pagamento = 'BOLETO'
  for update;
  if not found then
    raise exception 'Boleto % não encontrado para este usuário.', p_transacao_id
      using errcode = 'FW404', hint = 'Confira o id; o boleto pode estar excluído ou não ser BOLETO.';
  end if;

  v_venc := (v_src.data_vencimento + (p_meses || ' months')::interval)::date;
  v_comp := (v_src.data_compra     + (p_meses || ' months')::interval)::date;

  -- S-04: mesma janela de plausibilidade de criar_boleto/editar_boleto
  -- (0019): +5 anos venc, +5 anos competência (era +1 ano na competência).
  if v_venc > (now() at time zone 'America/Sao_Paulo')::date + interval '5 years' then
    raise exception 'vencimento do clone fora do intervalo plausível: %', v_venc
      using errcode = 'FW400', hint = 'Reduza o deslocamento de meses.';
  end if;
  if v_comp > (now() at time zone 'America/Sao_Paulo')::date + interval '5 years' then
    raise exception 'competência do clone fora do intervalo plausível: %', v_comp
      using errcode = 'FW400', hint = 'Reduza o deslocamento de meses.';
  end if;

  insert into public.transacoes_origem
    (user_id, descricao, valor_total, tipo, forma_pagamento, cartao_id,
     data_compra, num_parcelas, data_vencimento, categoria_id)
  values
    (v_user_id, v_src.descricao, v_src.valor_total, 'DESPESA', 'BOLETO', null,
     v_comp, 1, v_venc, v_src.categoria_id)  -- categoria copiada; trigger só age se null
  returning id into v_novo_id;

  insert into public.parcelas
    (user_id, transacao_id, fatura_id, numero, valor, data_competencia)
  values
    (v_user_id, v_novo_id, null, 1, v_src.valor_total, v_comp);

  return jsonb_build_object(
    'transacao_id',    v_novo_id,
    'data_vencimento', v_venc,
    'competencia',     v_comp,
    'status',          'A_PAGAR');
end;
$$;
