-- =====================================================================
-- 0025_regex_fatura_paga_itau.sql
-- Amplia fn_parece_pagamento_fatura para o padrão do Itaú, observado em
-- extrato real importado pelo usuário em 11/08/2026.
--
-- O QUE ESTAVA ERRADO:
-- A 0023 assumiu que pagamento de fatura sempre começa por um verbo:
--   (pagamento|pgto|pagto|pag) ... (fatura|cartao de credito)
-- O Itaú inverte a ordem e usa particípio, sem a palavra "pagamento":
--   "FATURA PAGA Itau Uniclas"  /  "FATURA PAGA ITAU UNICLAS"
-- Normalizado vira `fatura paga itau uniclas` — nenhuma alternativa casava.
--
-- MEDIÇÃO NO EXTRATO REAL (535 linhas OFX, antes deste patch):
--   detectadas pelo regex ............ 0
--   linhas que SÃO liquidação ........ 2
-- Ou seja: 100% de perda no formato do Itaú. É o risco residual que a
-- própria 0023 declarou ("banco com descrição atípica vira consumo e o
-- double-count volta") — agora com amostra para calibrar.
--
-- ESCOPO: uma alternativa a mais no regex. Nada além disso.
-- fn_fatura_liquidada_por, criar_importacao, confirmar_importacao,
-- insights.ts, vw_carteira e a UI ficam intactos. A trava que impede
-- falso positivo de virar liquidação continua sendo a mesma da 0023:
-- valor EXATO + vencimento em ±5 dias. Este patch só amplia quem é
-- CANDIDATO a passar por essa trava.
--
-- IMMUTABLE e search_path = '' preservados (a função entra em consulta
-- de importação e não pode depender de search_path do chamador).
-- =====================================================================

create or replace function public.fn_parece_pagamento_fatura(p_descricao text)
returns boolean
language sql
immutable
strict
set search_path = ''
as $fn$
  -- Os parênteses em volta da concatenação NÃO são estilo: em Postgres,
  -- `||` e `~` caem os dois na categoria "any other operator", mesma
  -- precedência e associatividade à esquerda. Sem eles, isto seria lido
  -- como `(texto ~ 'primeira') || '|resto'` — boolean concatenado com
  -- text, e a função nem retornaria o tipo certo.
  select public.fn_normalizar_descricao(p_descricao) ~ (
    -- verbo antes do substantivo: "PAGAMENTO FATURA", "PGTO FATURA",
    -- "PAG FATURA CARTAO NUBANK", "PAGAMENTO CARTAO DE CREDITO"
    '(^| )(pagamento|pgto|pagto|pag)( de)? (fatura|cartao de credito)( |$)'
    -- "FATURA DO CARTAO"
    || '|(^| )fatura (do )?cartao( |$)'
    -- "PAGAMENTO CARTAO"
    || '|(^| )pagamento cartao( |$)'
    -- 0025 — substantivo + particípio, sem verbo: padrão Itaú.
    -- `(^| )fatura ` exige "fatura" como palavra inteira, então
    -- "FATURAMENTO PAGO" não casa. `quitada|liquidada` entram porque
    -- têm a mesma forma e custo zero; não vi no extrato, mas também
    -- não abrem espaço novo para falso positivo.
    -- Ordem invertida com verbo ("PAGA FATURA") fica de fora de
    -- propósito: não foi observada e afrouxaria sem evidência.
    || '|(^| )fatura (paga|quitada|liquidada)( |$)'
  );
$fn$;

comment on function public.fn_parece_pagamento_fatura(text) is
  'Heurística de TEXTO apenas — nunca decide sozinha. Só vira LIQUIDACAO_FATURA quando uma fatura casa por valor exato em ±5 dias do vencimento (fn_fatura_liquidada_por). Cobre verbo+substantivo e, desde a 0025, substantivo+particípio (padrão Itaú "FATURA PAGA").';

-- Grants: assinatura inalterada, os da 0023 continuam valendo. Reemitidos
-- por idempotência, no mesmo padrão da 0022.
revoke execute on function public.fn_parece_pagamento_fatura(text) from public, anon;
grant  execute on function public.fn_parece_pagamento_fatura(text) to authenticated;
