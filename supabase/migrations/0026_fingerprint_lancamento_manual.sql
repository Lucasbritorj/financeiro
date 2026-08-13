-- =====================================================================
-- 0026_fingerprint_lancamento_manual.sql
-- Fecha o furo de dedup do lançamento manual.
--
-- O PROBLEMA
-- A 0020 criou transacoes_origem.fingerprint e um backfill, mas nenhuma RPC
-- de escrita passou a calcular o valor. Resultado: transação criada depois da
-- 0020 nasce com fingerprint NULL, e ao importar um extrato com a mesma linha
-- criar_importacao não casa no ramo `t.fingerprint = c.fp`; escorrega para o
-- ramo seguinte, que compara só data+valor+tipo, e classifica AMBIGUO.
--
-- Medido contra Postgres real: cenário do assert [C1] de
-- verificacao_assistente devolvia `duplicadas: 0, ambiguos: 1`. Preenchendo o
-- fingerprint da transação manual — única variável alterada — devolve
-- `duplicadas: 1, ambiguos: 0`.
--
-- POR QUE ISSO É BUG E NÃO DESIGN
-- O comentário da coluna na 0020 dizia "Null em lançamento manual". Mas o
-- backfill da seção 5 da própria 0020 não filtra por origem: preencheu também
-- os lançamentos manuais que já existiam. Manual anterior à 0020 era detectado
-- como DUPLICADO; manual posterior não. O backfill e a política de escrita
-- discordavam entre si. Este arquivo resolve a favor do backfill.
--
-- ONDE A CORREÇÃO FOI APLICADA — trigger, não RPC
-- transacoes_origem tem três portas de escrita que não preenchiam fingerprint:
-- processar_transacao_completa (0002, dois INSERTs), criar_boleto e
-- duplicar_boleto (0019). Corrigir só a primeira deixaria o mesmo bug vivo nas
-- outras duas. A alternativa considerada foi editar as três RPCs; foi
-- descartada porque multiplica o mesmo cálculo por três call-sites, que é
-- exatamente como a lista de asserts do CI divergiu.
-- O trigger é o ponto idiomático deste schema: transacoes_origem já usa
-- BEFORE INSERT para derivar campo (fn_autocategorizar_transacao, 0008) e
-- BEFORE UPDATE para updated_at (fn_touch_updated_at, 0006/0022).
--
-- confirmar_importacao NÃO é afetada: ela insere fingerprint já calculado (com
-- o ordinal do lote), e o trigger só age quando o campo chega NULL.
-- =====================================================================

-- ---------------------------------------------------------------- 1. Ordinal livre
-- O ordinal existe para que duas compras idênticas de verdade no mesmo dia
-- (dois cafés de R$5) coexistam como ocorrência 1 e 2 — ver 0020 seção 2.
-- Ao inserir, o ordinal certo é o primeiro que ainda não está ocupado por
-- linha viva do mesmo usuário. Contar linhas não serve: soft-delete abre
-- buracos e devolveria um ordinal já em uso.
--
-- Não é IMMUTABLE (consulta tabela) e por isso nunca pode entrar em índice —
-- só é chamada no caminho de escrita.
create or replace function public.fn_fingerprint_livre(
  p_user_id   uuid,
  p_data      date,
  p_centavos  bigint,        -- COM sinal: negativo = despesa
  p_descricao text
)
returns text
language plpgsql
stable
set search_path = ''
as $fn$
declare
  v_ord int := 1;
  v_fp  text;
begin
  -- Teto defensivo: 10k ocorrências do mesmo trio no mesmo dia é dado corrompido,
  -- não uso legítimo. Melhor falhar explicitamente que girar para sempre.
  while v_ord <= 10000 loop
    v_fp := public.fn_fingerprint_transacao(p_data, p_centavos, p_descricao, v_ord);
    if not exists (
      select 1 from public.transacoes_origem
      where user_id = p_user_id          -- escopo explícito: DEFINER bypassa RLS
        and fingerprint = v_fp
        and deleted_at is null
    ) then
      return v_fp;
    end if;
    v_ord := v_ord + 1;
  end loop;

  raise exception 'Não foi possível derivar fingerprint: 10000 ocorrências de "%" em % .',
    p_descricao, p_data
    using errcode = 'FW500',
    hint = 'Falha interna; não retente e reporte com a mensagem completa.';
end;
$fn$;

comment on function public.fn_fingerprint_livre(uuid, date, bigint, text) is
  'Primeiro fingerprint não ocupado por linha viva do usuário, incrementando o ordinal. Caminho de escrita apenas — não é IMMUTABLE, não serve para índice.';

-- ---------------------------------------------------------------- 2. Trigger
-- Só preenche quando chega NULL: quem já calculou o próprio fingerprint
-- (confirmar_importacao, com o ordinal do lote) tem precedência.
create or replace function public.fn_preencher_fingerprint()
returns trigger
language plpgsql
set search_path = ''
as $fn$
begin
  if new.fingerprint is null then
    new.fingerprint := public.fn_fingerprint_livre(
      new.user_id,
      new.data_compra,
      case when new.tipo = 'DESPESA' then -new.valor_total else new.valor_total end,
      new.descricao
    );
  end if;
  return new;
end;
$fn$;

comment on function public.fn_preencher_fingerprint() is
  'BEFORE INSERT em transacoes_origem: deriva fingerprint quando a porta de escrita não informou. Fecha o furo de dedup do lançamento manual (0026).';

drop trigger if exists trg_preencher_fingerprint on public.transacoes_origem;
create trigger trg_preencher_fingerprint
  before insert on public.transacoes_origem
  for each row execute function public.fn_preencher_fingerprint();

-- ---------------------------------------------------------------- 3. Backfill
-- Alcança o que nasceu entre a 0020 e hoje com fingerprint NULL. Sem isto a
-- correção só valeria para transação futura, e o extrato reimportado
-- continuaria vendo AMBIGUO no histórico já lançado à mão.
--
-- Iterativo, não set-based: o row_number() da 0020 numerava de 1 a N ignorando
-- os fingerprints JÁ gravados por importação, então podia derivar um valor em
-- uso e colidir com transacoes_fingerprint_uidx. fn_fingerprint_livre consulta
-- o estado a cada linha e desvia dos ocupados.
-- Ordem (created_at, id) é a mesma da 0020: estável e reproduzível.
-- Reversível: update public.transacoes_origem set fingerprint = null;
do $do$
declare
  r           record;
  v_afetadas  int := 0;
begin
  for r in
    select id, user_id, data_compra, descricao,
           case when tipo = 'DESPESA' then -valor_total else valor_total end as centavos
    from public.transacoes_origem
    where fingerprint is null and deleted_at is null
    order by created_at, id
  loop
    update public.transacoes_origem
       set fingerprint = public.fn_fingerprint_livre(
             r.user_id, r.data_compra, r.centavos, r.descricao)
     where id = r.id;
    v_afetadas := v_afetadas + 1;
  end loop;

  raise notice '0026: fingerprint preenchido em % transação(ões) sem valor.', v_afetadas;
end;
$do$;

-- ---------------------------------------------------------------- 4. Contrato
-- O comentário anterior ("Null em lançamento manual") descrevia o bug.
comment on column public.transacoes_origem.fingerprint is
  'fn_fingerprint_transacao(...). Preenchido em TODA transação viva: informado pela importação, derivado pelo trigger trg_preencher_fingerprint (0026) nas demais portas. Null só em linha soft-deletada anterior à 0026.';

revoke execute on function public.fn_fingerprint_livre(uuid, date, bigint, text)
  from public, anon, authenticated;
revoke execute on function public.fn_preencher_fingerprint()
  from public, anon, authenticated;
