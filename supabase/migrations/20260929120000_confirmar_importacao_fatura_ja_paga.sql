-- Fatura já PAGA não aborta a importação.
-- fn_fatura_liquidada_por casa também faturas PAGA (vw_faturas_consolidadas
-- não filtra status). Se o usuário baixou a fatura à mão antes de importar o
-- extrato, processar_pagamento_fatura levantava FW409, que o handler não
-- captura, e o lote inteiro revertia. O débito do extrato continua sendo
-- gravado (é saída real de caixa, vinculada à fatura); só a baixa, que já
-- aconteceu, deixa de ser repetida.
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
    select l.fatura_liquidada_id, min(l.data) as data_pagamento
    from public.importacao_linhas l
    join public.faturas f on f.id=l.fatura_liquidada_id and f.user_id=v_user_id
    where l.importacao_id=v_imp.id and l.user_id=v_user_id and l.deleted_at is null
      and not l.ignorar and l.classificacao <> 'DUPLICADO'
      and l.natureza_detectada='LIQUIDACAO_FATURA' and l.fatura_liquidada_id is not null
      and f.status <> 'PAGA'
    group by l.fatura_liquidada_id
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
