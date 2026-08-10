-- APLICAR_0017_0019.sql — bundle para o SQL Editor do Supabase (projetos que já aplicaram até 0016).
-- Conteúdo: 0017_endurecimento_auditoria.sql + 0018_importacao_guard_valor.sql + 0019_correcoes_auditoria_graph_loop.sql, na ordem.

-- 0017_endurecimento_auditoria.sql
--
-- Endurecimento defensivo derivado da auditoria de banco (Fase 1, 2026-07-22).
-- Nenhuma vulnerabilidade viva — são camadas de defesa em profundidade e
-- consistência com o padrão já adotado nas views. Idempotente (re-executável).
--
-- Cobre 3 achados:
--   #2 (MEDIUM) revoga SELECT de `anon` nas 11 tabelas de base (a RLS já barra
--       `anon` porque auth.uid() é NULL, mas as views usam só `authenticated` —
--       aqui alinhamos as tabelas ao mesmo mínimo privilégio).
--   #5 (LOW)    remove as policies de INSERT/UPDATE "mortas" das 4 tabelas
--       núcleo (inertes desde 0005, que revogou o DML de tabela; se um GRANT
--       fosse reconcedido por engano elas reviveriam silenciosamente).
--   #4 (MEDIUM) adiciona teto superior às colunas monetárias, fechando a janela
--       teórica de perda de precisão na borda JS (bigint tipado como `number`;
--       Number.MAX_SAFE_INTEGER ~ 9,007e15 centavos). Teto folgado para uso
--       pessoal: 999999999999 centavos = R$ 9.999.999.999,99.
--
-- NÃO cobre (follow-up documentado):
--   #7 (LOW) validação do cast jsonb->bigint em criar_importacao/0009+0016
--       (hoje falha com erro cru do Postgres em vez de FW400+hint). Exige
--       reescrever o corpo da função; fica para 0018 junto de novos formatos.

-- ---------------------------------------------------------------------------
-- #2 — Revoga SELECT de `anon` nas 11 tabelas de base (mantém `authenticated`).
-- ---------------------------------------------------------------------------
revoke select on public.cartoes_credito       from anon;
revoke select on public.faturas               from anon;
revoke select on public.transacoes_origem     from anon;
revoke select on public.parcelas              from anon;
revoke select on public.categorias            from anon;
revoke select on public.regras_categorizacao  from anon;
revoke select on public.importacoes           from anon;
revoke select on public.importacao_linhas     from anon;
revoke select on public.cofrinhos             from anon;
revoke select on public.movimentacoes_cofrinho from anon;
revoke select on public.recorrencias          from anon;

-- ---------------------------------------------------------------------------
-- #5 — Remove policies de INSERT/UPDATE mortas das 4 tabelas núcleo. O DML
--      direto já está revogado (0005); a leitura (SELECT) e a ausência de
--      DELETE físico permanecem intactas. As tabelas criadas depois (0008+)
--      já seguem este padrão (sem policy de insert/update, só default-deny).
-- ---------------------------------------------------------------------------
drop policy if exists cartoes_insert    on public.cartoes_credito;
drop policy if exists cartoes_update    on public.cartoes_credito;
drop policy if exists faturas_insert    on public.faturas;
drop policy if exists faturas_update    on public.faturas;
drop policy if exists transacoes_insert on public.transacoes_origem;
drop policy if exists transacoes_update on public.transacoes_origem;
drop policy if exists parcelas_insert   on public.parcelas;
drop policy if exists parcelas_update   on public.parcelas;

-- ---------------------------------------------------------------------------
-- #4 — Teto superior nas colunas monetárias persistidas (centavos bigint).
--      drop-then-add torna a migration re-executável.
-- ---------------------------------------------------------------------------
alter table public.cartoes_credito   drop constraint if exists cartoes_limite_total_teto;
alter table public.cartoes_credito   add  constraint cartoes_limite_total_teto
  check (limite_total <= 999999999999);

alter table public.transacoes_origem drop constraint if exists transacoes_valor_total_teto;
alter table public.transacoes_origem add  constraint transacoes_valor_total_teto
  check (valor_total <= 999999999999);

alter table public.parcelas          drop constraint if exists parcelas_valor_teto;
alter table public.parcelas          add  constraint parcelas_valor_teto
  check (valor <= 999999999999);

alter table public.categorias        drop constraint if exists categorias_orcamento_teto;
alter table public.categorias        add  constraint categorias_orcamento_teto
  check (orcamento_mensal is null or orcamento_mensal <= 999999999999);

alter table public.cofrinhos         drop constraint if exists cofrinhos_saldo_teto;
alter table public.cofrinhos         add  constraint cofrinhos_saldo_teto
  check (saldo_atual <= 999999999999);

-- =====================================================================
-- 0018_importacao_guard_valor.sql
-- Achado #7 da auditoria (2026-07-22): em criar_importacao, o cast implícito
-- jsonb->bigint dentro de jsonb_to_recordset falha com erro CRU do Postgres
-- (invalid input syntax for type bigint) se um parser da borda enviar 'valor'
-- fracionário (ex.: 4200.5) em vez de centavos inteiros — fora do protocolo
-- FW4xx usado no resto do projeto. Aqui adicionamos uma guarda de tipo
-- explícita ANTES do staging, devolvendo FW400 + hint acionável.
-- Só substitui a função (a constraint de origem da 0016 permanece).
-- =====================================================================

create or replace function public.criar_importacao(
  p_origem text,
  p_linhas jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_id      uuid;
  v_total   int;
  v_dup     int;
begin
  if v_user_id is null then
    raise exception 'Não autenticado.'
      using errcode = 'FW401', hint = 'Sessão ausente/expirada. Não retente; reautentique.';
  end if;
  if p_origem not in ('CSV','OFX','OFC','XLSX','PDF','PLUGGY') then
    raise exception 'origem inválida: %', p_origem
      using errcode = 'FW400', hint = 'Use CSV, OFX, OFC, XLSX, PDF ou PLUGGY.';
  end if;
  if p_linhas is null or jsonb_typeof(p_linhas) <> 'array' then
    raise exception 'p_linhas deve ser um array JSON.'
      using errcode = 'FW400', hint = 'Envie [{data, valor, descricao}, ...].';
  end if;
  v_total := jsonb_array_length(p_linhas);
  if v_total < 1 or v_total > 1000 then
    raise exception 'Importação com % linhas (mínimo 1, máximo 1000).', v_total
      using errcode = 'FW429', hint = 'Divida o arquivo em lotes de até 1000 linhas.';
  end if;

  -- Guarda de tipo (achado #7): 'valor' precisa ser um NÚMERO INTEIRO em
  -- centavos. Rejeita não-número, fração (contém '.') e notação científica
  -- ANTES do jsonb_to_recordset, trocando o erro cru do cast pelo FW400 padrão.
  if exists (
    select 1
    from jsonb_array_elements(p_linhas) as e
    where jsonb_typeof(e->'valor') is distinct from 'number'
       or (e->>'valor') like '%.%'
       or (e->>'valor') ilike '%e%'
  ) then
    raise exception 'Cada "valor" de importação deve ser inteiro em centavos.'
      using errcode = 'FW400',
            hint = 'Converta para centavos (inteiro) na borda antes de enviar; não mande fração nem notação científica.';
  end if;

  insert into public.importacoes (user_id, origem)
  values (v_user_id, p_origem)
  returning id into v_id;

  -- Uma passada set-based: valida, deduplica contra o razão e sugere
  -- categoria. Linha malformada derruba o lote inteiro (staging atômico).
  insert into public.importacao_linhas
    (importacao_id, user_id, data, valor, descricao, categoria_sugerida, duplicada, ignorar)
  select
    v_id, v_user_id, l.data, l.valor, trim(l.descricao),
    case when l.valor < 0
         then public.fn_sugerir_categoria(v_user_id, l.descricao) end,
    d.eh_dup, d.eh_dup
  from jsonb_to_recordset(p_linhas) as l(data date, valor bigint, descricao text)
  cross join lateral (
    select exists (
      select 1 from public.transacoes_origem t
      where t.user_id = v_user_id
        and t.deleted_at is null
        and t.data_compra = l.data
        and t.valor_total = abs(l.valor)
        and lower(trim(t.descricao)) = lower(trim(l.descricao))
    ) as eh_dup
  ) d
  where l.data is not null
    and l.valor is not null and l.valor <> 0
    and coalesce(trim(l.descricao), '') <> ''
    and l.data between date '2000-01-01'
        and (now() at time zone 'America/Sao_Paulo')::date + 1;

  get diagnostics v_total = row_count;
  if v_total <> jsonb_array_length(p_linhas) then
    raise exception 'Lote rejeitado: % de % linhas válidas.', v_total, jsonb_array_length(p_linhas)
      using errcode = 'FW400',
            hint = 'Toda linha precisa de data plausível (2000-01-01..amanhã), valor <> 0 em centavos e descrição.';
  end if;

  select count(*) into v_dup
  from public.importacao_linhas
  where importacao_id = v_id and duplicada;

  return jsonb_build_object(
    'importacao_id', v_id, 'linhas', v_total, 'duplicadas', v_dup);
end;
$$;

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

-- =====================================================================
-- S-06 (baixo) — default de movimentacoes_cofrinho.data não pode depender
-- do TimeZone da sessão (implícito). CLAUDE.md exige America/Sao_Paulo
-- explícito para qualquer data de regra de negócio; `current_date` lê o
-- TimeZone GUC da sessão, e Supabase hospedado roda UTC por padrão —
-- perto da virada do dia, UTC e America/Sao_Paulo discordam sobre qual é
-- "hoje". Hoje é INALCANÇÁVEL em produção: aportar_cofrinho e
-- resgatar_cofrinho (0010) sempre passam `data` explícito
-- (coalesce(p_data, (now() at time zone 'America/Sao_Paulo')::date)), e
-- não existe outro caminho de escrita para esta tabela (DML direto
-- revogado). É mina latente para qualquer INSERT futuro que confie no
-- default da coluna em vez de replicar o coalesce. ALTER COLUMN SET
-- DEFAULT é idempotente por natureza (só troca a expressão-padrão, não
-- reescreve linhas existentes) — dispensa drop-then-add.
-- =====================================================================
alter table public.movimentacoes_cofrinho
  alter column data set default ((now() at time zone 'America/Sao_Paulo')::date);

-- =====================================================================
-- S-05 (baixo) — tetos anti-abuso sem lock (TOCTOU sob READ COMMITTED).
-- select count(*) into v_qtd sem FOR UPDATE nem advisory lock: duas (ou
-- mais) chamadas concorrentes do MESMO usuário à mesma RPC podem ler o
-- MESMO count antes de qualquer uma commitar seu INSERT — todas passam
-- no teto (ex.: teto de 20 cartões vira 21, 22... conforme o grau de
-- paralelismo). FOR UPDATE não resolve aqui: o teto conta linhas
-- EXISTENTES, e ainda não há linha do novo registro para travar — a
-- trava precisa ser numa chave lógica compartilhada, não numa linha.
--
-- pg_advisory_xact_lock(hashtext(...)) serializa chamadas concorrentes do
-- MESMO usuário à MESMA rpc (chave = '<rpc>:<user_id>'); RPCs diferentes
-- ou usuários diferentes não colidem (exceto colisão de hash de 32 bits —
-- teórica, sem custo de correção, só uma serialização a mais numa
-- coincidência rara). Lock é escopo de TRANSAÇÃO (_xact_): liberado
-- automaticamente no fim, sem risco de ficar preso mesmo se a função
-- levantar exceção depois de adquiri-lo.
--
-- NÃO PROVADO por execução: PGlite (harness local desta auditoria) é uma
-- conexão lógica única — não há como abrir duas sessões concorrentes para
-- reproduzir a corrida de verdade (limitação documentada da própria
-- ferramenta, não desta migration). O que a suíte local prova é que a
-- trava NÃO QUEBRA o caminho feliz: as 4 RPCs abaixo continuam
-- funcionando e os asserts existentes que as exercitam (núcleo [1],
-- assistente B1/B5/B6/D1, isolamento) continuam verdes.
-- =====================================================================
create or replace function public.criar_cartao(
  p_nome           text,
  p_limite_total   bigint,   -- centavos
  p_dia_fechamento int,
  p_dia_vencimento int
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_qtd     int;
  v_id      uuid;
begin
  if v_user_id is null then
    raise exception 'Não autenticado.'
      using errcode = 'FW401', hint = 'Sessão ausente/expirada. Não retente; reautentique.';
  end if;
  if coalesce(trim(p_nome), '') = '' then
    raise exception 'nome é obrigatório.'
      using errcode = 'FW400', hint = 'Informe um nome para o cartão.';
  end if;
  if p_limite_total is null or p_limite_total <= 0 then
    raise exception 'limite_total deve ser positivo, em centavos. Recebido: %', p_limite_total
      using errcode = 'FW400', hint = 'Envie o limite em centavos (inteiro > 0).';
  end if;
  if coalesce(p_dia_fechamento, 0) not between 1 and 31
     or coalesce(p_dia_vencimento, 0) not between 1 and 31 then
    raise exception 'Dias de fechamento/vencimento devem estar entre 1 e 31.'
      using errcode = 'FW400', hint = 'Ajuste os dias para o intervalo [1, 31].';
  end if;

  -- S-05: serializa concorrência do MESMO usuário nesta MESMA rpc antes
  -- de ler o count usado pelo teto anti-abuso.
  perform pg_advisory_xact_lock(hashtext('criar_cartao:' || v_user_id::text));

  -- Anti-abuso: teto de cartões ativos por usuário.
  select count(*) into v_qtd
  from public.cartoes_credito
  where user_id = v_user_id and deleted_at is null;
  if v_qtd >= 20 then
    raise exception 'Teto de 20 cartões ativos atingido.'
      using errcode = 'FW429', hint = 'Exclua (soft delete) um cartão antes de criar outro.';
  end if;

  insert into public.cartoes_credito
    (user_id, nome, limite_total, dia_fechamento, dia_vencimento)
  values
    (v_user_id, trim(p_nome), p_limite_total, p_dia_fechamento, p_dia_vencimento)
  returning id into v_id;

  return jsonb_build_object('cartao_id', v_id);
end;
$$;

create or replace function public.criar_categoria(
  p_nome             text,
  p_cor              text default null,
  p_icone            text default null,
  p_tipo             text default 'DESPESA',
  p_categoria_pai    uuid default null,
  p_orcamento_mensal bigint default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_qtd int;
  v_id  uuid;
begin
  if v_user_id is null then
    raise exception 'Não autenticado.'
      using errcode = 'FW401', hint = 'Sessão ausente/expirada. Não retente; reautentique.';
  end if;
  if coalesce(trim(p_nome), '') = '' then
    raise exception 'nome é obrigatório.'
      using errcode = 'FW400', hint = 'Informe um nome para a categoria.';
  end if;
  if p_tipo not in ('DESPESA','RECEITA') then
    raise exception 'tipo inválido: %', p_tipo
      using errcode = 'FW400', hint = 'Use DESPESA ou RECEITA.';
  end if;
  if p_orcamento_mensal is not null and p_orcamento_mensal <= 0 then
    raise exception 'orcamento_mensal deve ser positivo em centavos ou nulo.'
      using errcode = 'FW400', hint = 'Envie centavos (inteiro > 0) ou omita.';
  end if;
  if p_categoria_pai is not null and not exists (
      select 1 from public.categorias
      where id = p_categoria_pai and user_id = v_user_id and deleted_at is null) then
    raise exception 'categoria_pai % não encontrada para este usuário.', p_categoria_pai
      using errcode = 'FW404', hint = 'Confira o id da categoria-mãe.';
  end if;

  -- S-05: serializa concorrência do MESMO usuário nesta MESMA rpc antes
  -- de ler o count usado pelo teto anti-abuso.
  perform pg_advisory_xact_lock(hashtext('criar_categoria:' || v_user_id::text));

  select count(*) into v_qtd
  from public.categorias where user_id = v_user_id and deleted_at is null;
  if v_qtd >= 60 then
    raise exception 'Teto de 60 categorias ativas atingido.'
      using errcode = 'FW429', hint = 'Exclua uma categoria antes de criar outra.';
  end if;

  insert into public.categorias
    (user_id, nome, cor, icone, tipo, categoria_pai, orcamento_mensal)
  values
    (v_user_id, trim(p_nome), p_cor, p_icone, p_tipo, p_categoria_pai, p_orcamento_mensal)
  returning id into v_id;

  return jsonb_build_object('categoria_id', v_id);
exception
  when unique_violation then
    raise exception 'Já existe categoria ativa com o nome "%".', trim(p_nome)
      using errcode = 'FW409', hint = 'Use outro nome ou edite a existente.';
end;
$$;

create or replace function public.criar_regra_categorizacao(
  p_padrao       text,
  p_categoria_id uuid,
  p_prioridade   int default 100
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_qtd int;
  v_id  uuid;
begin
  if v_user_id is null then
    raise exception 'Não autenticado.'
      using errcode = 'FW401', hint = 'Sessão ausente/expirada. Não retente; reautentique.';
  end if;
  if coalesce(trim(p_padrao), '') = '' or length(trim(p_padrao)) < 2 then
    raise exception 'padrao deve ter ao menos 2 caracteres.'
      using errcode = 'FW400', hint = 'Padrões de 1 caractere casariam com quase tudo.';
  end if;
  if not exists (select 1 from public.categorias
                 where id = p_categoria_id and user_id = v_user_id and deleted_at is null) then
    raise exception 'Categoria % não encontrada para este usuário.', p_categoria_id
      using errcode = 'FW404', hint = 'Confira o id da categoria.';
  end if;

  -- S-05: serializa concorrência do MESMO usuário nesta MESMA rpc antes
  -- de ler o count usado pelo teto anti-abuso.
  perform pg_advisory_xact_lock(hashtext('criar_regra_categorizacao:' || v_user_id::text));

  select count(*) into v_qtd
  from public.regras_categorizacao where user_id = v_user_id and deleted_at is null;
  if v_qtd >= 200 then
    raise exception 'Teto de 200 regras ativas atingido.'
      using errcode = 'FW429', hint = 'Exclua regras antes de criar outra.';
  end if;

  insert into public.regras_categorizacao (user_id, padrao, categoria_id, prioridade)
  values (v_user_id, trim(p_padrao), p_categoria_id, coalesce(p_prioridade, 100))
  returning id into v_id;

  return jsonb_build_object('regra_id', v_id);
end;
$$;

create or replace function public.criar_cofrinho(
  p_nome       text,
  p_valor_alvo bigint,
  p_horizonte  text,
  p_data_alvo  date default null,
  p_icone      text default null,
  p_cor        text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_qtd int;
  v_id  uuid;
begin
  if v_user_id is null then
    raise exception 'Não autenticado.'
      using errcode = 'FW401', hint = 'Sessão ausente/expirada. Não retente; reautentique.';
  end if;
  if coalesce(trim(p_nome), '') = '' then
    raise exception 'nome é obrigatório.'
      using errcode = 'FW400', hint = 'Dê um nome ao cofrinho (ex.: Reserva de emergência).';
  end if;
  if p_valor_alvo is null or p_valor_alvo <= 0 then
    raise exception 'valor_alvo deve ser positivo, em centavos. Recebido: %', p_valor_alvo
      using errcode = 'FW400', hint = 'Envie o alvo em centavos (inteiro > 0).';
  end if;
  if p_horizonte not in ('CURTO','MEDIO','LONGO') then
    raise exception 'horizonte inválido: %', p_horizonte
      using errcode = 'FW400', hint = 'Use CURTO, MEDIO ou LONGO.';
  end if;
  if p_data_alvo is not null
     and p_data_alvo <= (now() at time zone 'America/Sao_Paulo')::date then
    raise exception 'data_alvo deve ser futura: %', p_data_alvo
      using errcode = 'FW400', hint = 'Escolha uma data após hoje ou omita.';
  end if;

  -- S-05: serializa concorrência do MESMO usuário nesta MESMA rpc antes
  -- de ler o count usado pelo teto anti-abuso.
  perform pg_advisory_xact_lock(hashtext('criar_cofrinho:' || v_user_id::text));

  select count(*) into v_qtd
  from public.cofrinhos
  where user_id = v_user_id and deleted_at is null and not arquivado;
  if v_qtd >= 30 then
    raise exception 'Teto de 30 cofrinhos ativos atingido.'
      using errcode = 'FW429', hint = 'Arquive um cofrinho antes de criar outro.';
  end if;

  insert into public.cofrinhos (user_id, nome, valor_alvo, horizonte, data_alvo, icone, cor)
  values (v_user_id, trim(p_nome), p_valor_alvo, p_horizonte, p_data_alvo, p_icone, p_cor)
  returning id into v_id;

  return jsonb_build_object('cofrinho_id', v_id);
end;
$$;
