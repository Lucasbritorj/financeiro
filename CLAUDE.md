@AGENTS.md

# CLAUDE.md — financeiro-web

Regras inflexíveis deste projeto. Detalhe de regra de negócio mora nas migrations e nos asserts
de `supabase/tests/`; aqui fica só o que não se pode errar.

## Classe e objetivo
- **Classe: crítico** (dinheiro e dado pessoal). Piso: CI verde (jobs `node`, `e2e`, `lighthouse`,
  `sql`), `npm audit --omit=dev` sem alta, sem segredo, regra de dinheiro em constraint ou teste,
  `/security-review` (comando do Lucas) antes de deploy que toque auth, RLS ou RPC, e produção
  conferida no navegador logado.
- **Objetivo: não declarado.** Até o Lucas declarar, só manutenção do piso.

## Comandos
- rodar: `npm run dev` · testar: `npm test` (unit + gates de migration), `npm run test:sql`
  (Postgres 17 em Docker) · espelho do CI: `npm run gate` · pós-deploy: `npm run smoke -- <url>`.
- publicar: merge na `master` publica na Vercel. Só por PR com CI verde e ok do Lucas.

## Regras invioláveis
- **Dinheiro:** inteiro em centavos (`bigint`) no banco, RPC e lógica. Conversão só em
  `src/lib/money.ts` (`paraCentavos` na UI, `paraCentavosAssinado` na importação). O hook
  `invariantes-guard` barra float monetário fora dele; nunca contorne pelo shell.
- **Fuso:** `America/Sao_Paulo` para fechamento, competência e compra. SQL usa
  `(now() at time zone 'America/Sao_Paulo')::date`, nunca `current_date`; cliente usa
  `hojeSaoPaulo()` e `mesCorrenteSaoPaulo()`, nunca `new Date()` local.
- **Escrita só por RPC.** `authenticated` só tem SELECT, `anon` nada; nunca reconceda DML.
  Objeto novo revoga na própria migration (o default de `public` ainda concede):
  - tabela: revoke DML, RLS com policy por `auth.uid()`, `trg_touch_updated_at`;
  - view: `security_invoker = true`, revoke de `public, anon`, grant select a `authenticated`.
- **RPC de escrita:** `SECURITY DEFINER` + `set search_path = ''`, filtra e insere
  `user_id = auth.uid()` (usuário nunca vem do cliente), revoke execute de `public`/`anon`.
  Teto anti-abuso com `pg_advisory_xact_lock` antes do `count`.
- **Erros de RPC:** SQLSTATE `FW400/401/404/409/429/500` + `hint` acionável; o front exibe os dois.
- **Soft delete:** nunca `DELETE` físico. Exclusão seta `deleted_at` via RPC; leitura e índice
  único novo têm `WHERE deleted_at IS NULL`; `ON CONFLICT` em índice parcial repete o predicado.
- **Histórico pago não se apaga:** parcela ou fatura PAGA bloqueia com FW409; se estorna.
- **Totais de fatura** vêm de `vw_faturas_consolidadas`; parcela guarda valor absoluto, o sinal
  vive na view.
- **Lote:** `aplicar_recorrencias` isola falha por ocorrência; `confirmar_importacao` é atômica.
  Não troque um padrão pelo outro.

## Schema e migrações
- `supabase/migrations/` é a fonte da verdade. Nova nasce com `supabase migration new`, é citada
  no Setup do README (o gate `readme-migracoes` cobra) e aplica em ordem de nome.
- Alterou schema: regenere `src/lib/database.types.ts`. Alterou regra no SQL: ajuste o assert.
- **O CLI local está linkado à produção**: `supabase db push`/`config push` atingem o banco real.
  `db push` segue vetado até decisão do Lucas (D10).

## Pegadinhas
- Next 16 renomeou `middleware` para `proxy` (`src/proxy.ts`); não crie `middleware.ts`.
- `trg_touch_updated_at` usa `clock_timestamp()`, porque `now()` congela no início da transação.
- `fechar_faturas` já é agendada pela 0014 (`fechar-faturas-diario`); não crie outro job.
- Falha em escrita com efeito (migration, RPC, deploy, push): leia o estado real antes de
  repetir, pode ter aplicado em parte.
- `.claude/agent-core/` e `memory/` são legado do antigravity-core: não siga nem cite.

## Revisão
- Antes de merge: skill `code-review` sobre o diff e este arquivo. Bloqueia só por correção,
  segurança ou requisito; confere centavos/reais e fuso na borda. No máximo 3 rodadas, depois
  escale ao Lucas.

## Decisões
- 2026-09-30 Histórico de migrations remoto igual ao local (29 versões); veto de `db push` mantido.
- 2026-09-30 Hook `invariantes-guard` passa a ver MultiEdit (PR #8).
- 2026-09-30 Classe crítico declarada; objetivo pendente.
