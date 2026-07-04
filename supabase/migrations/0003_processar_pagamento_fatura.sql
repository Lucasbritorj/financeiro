-- =====================================================================
-- 0003_processar_pagamento_fatura.sql
-- Máquina de estados de pagamento: fatura ABERTA/FECHADA -> PAGA, com
-- baixa em lote das parcelas filhas. O schema original não tinha colunas
-- de auditoria temporal — adicionadas aqui antes da RPC que as usa.
--
-- Códigos de erro estáveis (protocolo_de_erro na camada SQL):
--   FW400 input inválido · FW401 não autenticado · FW404 não encontrado
--   FW409 estado conflitante · (FW429 limite, ver 0002)
-- =====================================================================

-- Colunas exigidas pela máquina de estados (idempotente em re-execução).
alter table public.faturas  add column if not exists updated_at timestamptz not null default now();
alter table public.parcelas add column if not exists updated_at timestamptz not null default now();
alter table public.parcelas add column if not exists data_pagamento timestamptz;

-- SECURITY INVOKER: roda sob a RLS do chamador — fatura de outro usuário é
-- invisível e cai no FW404. Função PL/pgSQL é atômica: qualquer RAISE reverte
-- fatura e parcelas juntas.
create or replace function public.processar_pagamento_fatura(
  p_fatura_id       uuid,
  p_data_pagamento  timestamptz default now()
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_fatura  public.faturas%rowtype;
  v_pagas   int;
begin
  if v_user_id is null then
    raise exception 'Não autenticado.'
      using errcode = 'FW401', hint = 'Não retente; sessão expirada — reautentique.';
  end if;
  if p_fatura_id is null then
    raise exception 'p_fatura_id é obrigatório.'
      using errcode = 'FW400', hint = 'Informe o uuid da fatura e chame novamente.';
  end if;

  -- FOR UPDATE: dois pagamentos simultâneos da mesma fatura serializam;
  -- o segundo enxerga status = PAGA e falha no FW409 (idempotência dura).
  select * into v_fatura
  from public.faturas
  where id = p_fatura_id and user_id = v_user_id and deleted_at is null
  for update;
  if not found then
    raise exception 'Fatura % não encontrada para este usuário.', p_fatura_id
      using errcode = 'FW404', hint = 'Confira o id; a fatura pode estar soft-deletada.';
  end if;
  if v_fatura.status = 'PAGA' then
    raise exception 'Fatura % já está PAGA.', p_fatura_id
      using errcode = 'FW409', hint = 'Pagamento já aplicado; não repita a operação.';
  end if;

  update public.faturas
     set status = 'PAGA', updated_at = now()
   where id = v_fatura.id;

  -- Baixa em lote das parcelas ativas; status <> 'PAGA' preserva
  -- data_pagamento de parcela eventualmente quitada de forma avulsa.
  update public.parcelas
     set status = 'PAGA',
         data_pagamento = coalesce(p_data_pagamento, now()),
         updated_at = now()
   where fatura_id = v_fatura.id
     and deleted_at is null
     and status <> 'PAGA';
  get diagnostics v_pagas = row_count;

  return jsonb_build_object(
    'fatura_id',      v_fatura.id,
    'status',         'PAGA',
    'parcelas_pagas', v_pagas,
    'data_pagamento', coalesce(p_data_pagamento, now()));
end;
$$;
