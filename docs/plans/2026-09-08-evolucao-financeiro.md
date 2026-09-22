# Evolução do financeiro

## Objetivo

Corrigir as contraprovas F01-F04 da auditoria e elevar o produto com fechamento mensal assistido, integração explícita entre orçamento e metas e navegação móvel utilizável.

## Restrições globais

- Trabalhar somente no worktree `C:\Users\Lucas\Workspace\financeiro-evolucao`.
- Nenhuma migration será aplicada ao Supabase remoto nesta execução.
- SQL novo deve preservar isolamento por `auth.uid()`, validar entrada, limitar privilégios e passar na suíte Postgres local.
- Mudança funcional segue RED-GREEN: teste falha pelo defeito esperado antes do código de produção.
- Não expor credenciais; não editar `.env` nem arquivos em `supabase/.temp`.
- Usar componentes cliente apenas onde houver estado, eventos ou APIs do navegador.

## Task 1 - F02: retomada segura da importação

- Quando `criar_importacao` responder `arquivo_ja_importado=true` e `status_anterior=REVISAO`, reler as linhas pelo `importacao_id` retornado e abrir a revisão.
- Se `descartar_importacao` falhar, manter a revisão aberta e exibir o erro.
- Cobrir ambos os casos em `tests/componentes/use-importacao.test.ts` com RED comprovado.

## Task 2 - F01/F03/F04: integridade transacional

- Criar migration nova usando `supabase migration new`.
- F01: substituir/editar transação conciliada deve preservar semântica de liquidação, origem externa e vínculo com a fatura, ou recusar alteração incompatível explicitamente.
- F03: confirmação de importação que identifica pagamento de fatura deve liquidar a fatura e refletir uma única saída no caixa.
- F04: edição de transação manual deve atualizar seu fingerprint para que um extrato antigo não seja classificado falsamente como duplicado.
- Transformar as contraprovas em asserts SQL de regressão; validar concorrência, idempotência, RLS e privilégios.

## Task 3 - Fechamento assistido e orçamento/metas

- Criar uma visão útil de fechamento mensal: realizado, projeção, orçamento total, diferença e metas/cofrinhos relevantes.
- Mostrar ações claras para revisar despesas, ajustar envelopes e acompanhar aportes sem automatizar movimentações financeiras.
- Reusar dados existentes; evitar novo schema quando os dados atuais bastarem.
- Cobrir lógica pura e componentes principais.

## Task 4 - Navegação móvel

- Tornar rotas protegidas principais acessíveis em viewport móvel sem rolagem horizontal impraticável.
- Preservar indicação de rota ativa, teclado e leitores de tela.
- Cobrir renderização/interação do menu móvel.

## Verificação final

- `npm test`
- `npm run test:componentes`
- `npm run test:sql`
- `npm run lint`
- `npm run build`
- `npm run gate`
- Verificação browser das rotas afetadas quando ambiente autenticado/local permitir.
- Revisão final do diff inteiro antes de qualquer push, deploy ou migration remota.
