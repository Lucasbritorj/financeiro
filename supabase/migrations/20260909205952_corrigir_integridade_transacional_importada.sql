-- F01/F03/F04: mantém a identidade de lançamentos importados, liquida a
-- fatura uma única vez e mantém o fingerprint coerente após edição.

-- F04: a função de INSERT não pode reutilizar o próprio fingerprint na edição.
create or replace function public.fn_fingerprint_livre(
  p_user_id uuid,
  p_data date,
  p_centavos bigint,
  p_descricao text,
  p_ignorar_transacao_id uuid
)
returns text
language plpgsql
stable
set search_path = ''
as $fn$
declare
  v_ord int := 1;
  v_fp text;
begin
  while v_ord <= 10000 loop
    v_fp := public.fn_fingerprint_transacao(p_data, p_centavos, p_descricao, v_ord);
    if not exists (
      select 1 from public.transacoes_origem
      where user_id = p_user_id
        and fingerprint = v_fp
        and deleted_at is null
        and id is distinct from p_ignorar_transacao_id
    ) then
      return v_fp;
    end if;
    v_ord := v_ord + 1;
  end loop;
  raise exception 'Não foi possível derivar fingerprint após 10000 ocorrências.'
    using errcode = 'FW500', hint = 'Falha interna; não retente.';
end;
$fn$;

create or replace function public.fn_preencher_fingerprint()
returns trigger
language plpgsql
set search_path = ''
as $fn$
begin
  if new.fingerprint is null
     or (tg_op = 'UPDATE' and (
       new.data_compra, new.valor_total, new.tipo, new.descricao
     ) is distinct from (
       old.data_compra, old.valor_total, old.tipo, old.descricao
     )) then
    new.fingerprint := public.fn_fingerprint_livre(
      new.user_id,
      new.data_compra,
      case when new.tipo = 'DESPESA' then -new.valor_total else new.valor_total end,
      new.descricao,
      case when tg_op = 'UPDATE' then old.id else null end
    );
  end if;
  return new;
end;
$fn$;

drop trigger if exists trg_preencher_fingerprint on public.transacoes_origem;
create trigger trg_preencher_fingerprint
  before insert or update of data_compra, valor_total, tipo, descricao
  on public.transacoes_origem
  for each row execute function public.fn_preencher_fingerprint();

-- F01: substituir uma liquidação não pode transformá-la em consumo manual.
create or replace function public.substituir_transacao(
  p_transacao_id uuid,
  p_descricao text,
  p_valor_total bigint,
  p_tipo text,
  p_forma_pagamento text,
  p_cartao_id uuid default null,
  p_data_compra date default null,
  p_num_parcelas int default 1,
  p_categoria_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_user_id uuid := auth.uid();
  v_old public.transacoes_origem%rowtype;
  v_res jsonb;
  v_new uuid;
begin
  if v_user_id is null then
    raise exception 'Não autenticado.' using errcode='FW401', hint='Sessão ausente/expirada. Não retente; reautentique.';
  end if;
  if p_transacao_id is null then
    raise exception 'p_transacao_id é obrigatório.' using errcode='FW400', hint='Informe o uuid da transação.';
  end if;

  select * into v_old from public.transacoes_origem
  where id = p_transacao_id and user_id = v_user_id and deleted_at is null
  for update;
  if not found then
    raise exception 'Transação % não encontrada para este usuário.', p_transacao_id
      using errcode='FW404', hint='Confira o id; a transação pode estar excluída.';
  end if;
  if exists (select 1 from public.parcelas
             where transacao_id=v_old.id and user_id=v_user_id and status='PAGA' and deleted_at is null) then
    raise exception 'Transação % tem parcela PAGA — não pode ser alterada.', p_transacao_id
      using errcode='FW409', hint='Histórico pago não se edita; lance um estorno (RECEITA).';
  end if;
  if exists (select 1 from public.parcelas p join public.faturas f on f.id=p.fatura_id
             where p.transacao_id=v_old.id and p.user_id=v_user_id and p.deleted_at is null
               and f.deleted_at is null and f.status <> 'ABERTA') then
    raise exception 'Transação % tem parcela em fatura FECHADA/PAGA.', p_transacao_id
      using errcode='FW409', hint='Ciclo fechado não reabre; estorne em vez de editar.';
  end if;
  if p_categoria_id is not null and not exists (
    select 1 from public.categorias where id=p_categoria_id and user_id=v_user_id and deleted_at is null
  ) then
    raise exception 'Categoria % não encontrada para este usuário.', p_categoria_id
      using errcode='FW404', hint='Confira o id da categoria.';
  end if;

  -- Um pagamento conciliado já quitou exatamente uma fatura. Só campos que
  -- não alteram essa identidade podem mudar; o restante exige estorno.
  if v_old.natureza = 'LIQUIDACAO_FATURA' and (
       p_tipo <> 'DESPESA'
       or p_forma_pagamento not in ('DEBITO','PIX','DINHEIRO')
       or p_cartao_id is not null
       or p_valor_total is distinct from v_old.valor_total
       or p_data_compra is distinct from v_old.data_compra
       or coalesce(p_num_parcelas, 1) <> 1
     ) then
    raise exception 'Liquidação de fatura só permite editar descrição ou categoria.'
      using errcode='FW409', hint='Para alterar valor, data ou forma de pagamento, registre um estorno.';
  end if;

  update public.transacoes_origem set deleted_at=now() where id=v_old.id;
  v_res := public.processar_transacao_completa(
    p_descricao, p_valor_total, p_tipo, p_forma_pagamento,
    p_cartao_id, p_data_compra, coalesce(p_num_parcelas,1));
  v_new := (v_res->>'transacao_id')::uuid;

  update public.transacoes_origem
     set categoria_id = coalesce(p_categoria_id, categoria_id),
         source = v_old.source,
         id_externo = v_old.id_externo,
         natureza = v_old.natureza,
         fatura_liquidada_id = v_old.fatura_liquidada_id
   where id=v_new and user_id=v_user_id;

  return jsonb_build_object('transacao_id', v_new, 'substituida', v_old.id,
    'parcelas_criadas', v_res->'parcelas_criadas');
end;
$fn$;
revoke execute on function public.substituir_transacao(uuid,text,bigint,text,text,uuid,date,int,uuid) from public, anon;
grant execute on function public.substituir_transacao(uuid,text,bigint,text,text,uuid,date,int,uuid) to authenticated;

-- Uma fatura pode ter somente um lançamento vivo de liquidação. A constraint
-- fecha a corrida entre confirmações concorrentes; a transação perdedora reverte.
create unique index if not exists transacoes_uma_liquidacao_por_fatura_uidx
  on public.transacoes_origem (user_id, fatura_liquidada_id)
  where fatura_liquidada_id is not null and deleted_at is null;

-- F03: confirmar materializa e quita cada fatura distinta dentro da mesma
-- transação curta. O lock de importação mantém a confirmação idempotente.
create or replace function public.confirmar_importacao(p_importacao_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_user_id uuid := auth.uid();
  v_imp public.importacoes%rowtype;
  v_criadas int;
  v_liquidacao record;
begin
  if v_user_id is null then
    raise exception 'Não autenticado.' using errcode='FW401', hint='Sessão ausente/expirada. Não retente; reautentique.';
  end if;
  select * into v_imp from public.importacoes
  where id=p_importacao_id and user_id=v_user_id and deleted_at is null for update;
  if not found then
    raise exception 'Importação % não encontrada para este usuário.', p_importacao_id
      using errcode='FW404', hint='Confira o id da importação.';
  end if;
  if v_imp.status <> 'REVISAO' then
    raise exception 'Importação % já está %.', p_importacao_id, v_imp.status
      using errcode='FW409', hint='Commit é único por importação — não retente.';
  end if;

  with alvo as (
    select data, abs(valor) as valor_abs,
      case when valor < 0 then 'DESPESA' else 'RECEITA' end as tipo,
      descricao, categoria_sugerida, id_externo, fingerprint,
      natureza_detectada, fatura_liquidada_id
    from public.importacao_linhas
    where importacao_id=v_imp.id and user_id=v_user_id and deleted_at is null
      and not ignorar and classificacao <> 'DUPLICADO'
  ), novas as (
    insert into public.transacoes_origem
      (user_id,descricao,valor_total,tipo,forma_pagamento,cartao_id,data_compra,
       num_parcelas,categoria_id,id_externo,fingerprint,source,natureza,fatura_liquidada_id)
    select v_user_id,a.descricao,a.valor_abs,a.tipo,'DEBITO',null,a.data,1,
      a.categoria_sugerida,a.id_externo,a.fingerprint,v_imp.origem,
      a.natureza_detectada,a.fatura_liquidada_id
    from alvo a
    returning id, valor_total, data_compra
  )
  insert into public.parcelas (user_id,transacao_id,fatura_id,numero,valor,data_competencia)
  select v_user_id,n.id,null,1,n.valor_total,n.data_compra from novas n;
  get diagnostics v_criadas = row_count;

  for v_liquidacao in
    select fatura_liquidada_id, min(data) as data_pagamento
    from public.importacao_linhas
    where importacao_id=v_imp.id and user_id=v_user_id and deleted_at is null
      and not ignorar and classificacao <> 'DUPLICADO'
      and natureza_detectada='LIQUIDACAO_FATURA' and fatura_liquidada_id is not null
    group by fatura_liquidada_id
  loop
    perform public.processar_pagamento_fatura(
      v_liquidacao.fatura_liquidada_id,
      v_liquidacao.data_pagamento::timestamptz
    );
  end loop;

  update public.importacoes set status='CONFIRMADA' where id=v_imp.id;
  return jsonb_build_object('importacao_id',v_imp.id,'transacoes_criadas',v_criadas);
exception when unique_violation then
  raise exception 'Importação % colidiu com transação já existente.', p_importacao_id
    using errcode='FW409', hint='Alguma linha já foi gravada por outra importação. Descarte este lote e reimporte para reclassificar.';
end;
$fn$;
revoke execute on function public.confirmar_importacao(uuid) from public, anon;
grant execute on function public.confirmar_importacao(uuid) to authenticated;

revoke execute on function public.fn_fingerprint_livre(uuid,date,bigint,text,uuid)
  from public, anon, authenticated;