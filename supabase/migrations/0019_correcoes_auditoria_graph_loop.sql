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
