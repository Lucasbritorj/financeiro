# financeiro-web

Gestão financeira com foco em **auditoria e integridade matemática**. O Supabase
(PostgreSQL) é a única fonte da verdade: toda escrita transacional passa pela
função RPC `processar_transacao_completa`, que garante atomicidade, divisão
centesimal sem sobras (resto na 1ª parcela) e a invariante
`SUM(parcelas) = valor_total`.

**Stack:** Next.js 16 (App Router) · Supabase (Postgres + Auth + RLS) · Tailwind.
**Convenção:** valores monetários trafegam como **centavos** (`bigint`), moeda BRL,
fuso de negócio `America/Sao_Paulo`.

## Setup

1. Crie um projeto em [supabase.com](https://supabase.com).
2. No **SQL Editor**, execute na ordem (0002 e 0003 são `CREATE OR REPLACE`:
   re-execute as versões atuais **antes** de 0005, que revoga o DML direto):
   - `supabase/migrations/0001_nucleo_transacional.sql` (tabelas, índices, RLS, cascata de soft delete)
   - `supabase/migrations/0002_processar_transacao_completa.sql` (motor de parcelamento + guard de limite + trava de fatura liquidada)
   - `supabase/migrations/0003_processar_pagamento_fatura.sql` (colunas de auditoria + máquina de estados de pagamento)
   - `supabase/migrations/0004_faturas_unique_parcial.sql` (unicidade só entre faturas ativas — soft delete não trava competência)
   - `supabase/migrations/0005_blindagem_privilegios.sql` (least privilege: REVOKE de DML direto, fim do DELETE físico, RPC `criar_cartao`, view `vw_faturas_consolidadas`)
3. (Opcional) Execute `supabase/tests/verificacao_nucleo.sql` — roda 14 asserts
   (divisão centesimal, Falha do Dia 31, corte de fechamento, idempotência,
   fluxo não-crédito, limite de crédito, pagamento de fatura, repagamento
   bloqueado, recriação pós soft-delete, trava de fatura paga, teto de
   parcelas, estorno na view, DML direto negado, erro FW404) e termina em
   `ROLLBACK`, sem persistir nada.
4. Copie `.env.example` para `.env.local` e preencha com os valores de
   **Settings → API** do projeto.
5. Para testar rápido, desative **Confirm email** em Authentication → Providers → Email.
6. `npm install && npm run dev` e acesse http://localhost:3000.

## Estrutura

- `supabase/` — migrations e script de verificação (fonte da verdade do schema).
- `src/proxy.ts` — renova a sessão Supabase e protege as rotas (Next 16 renomeou `middleware` para `proxy`).
- `src/lib/supabase/` — clients browser (`client.ts`) e server (`server.ts`, cookies via `@supabase/ssr`).
- `src/lib/database.types.ts` — tipos do schema (regenere com `npx supabase gen types typescript --project-id <id>`).
- `src/lib/money.ts` — conversão reais ↔ centavos na borda da UI.
- `src/app/(protegido)/` — telas de transações, faturas e cartões (leitura direta sob RLS).

## Regras de negócio do motor

- Compra com dia >= dia de fechamento entra na fatura do mês seguinte.
- Dia inexistente no mês (ex.: 31 em fevereiro): usa o último dia do mês, nunca rola para o próximo.
- Vencimento cai no mês seguinte à competência quando `dia_vencimento <= dia_fechamento`.
- Pagamentos não-crédito geram 1 parcela sem fatura (fluxo de caixa unificado).
- Parcelas só entram em faturas `ABERTA`; faturas são criadas sob demanda com `ON CONFLICT` (à prova de corrida).
- Limite de crédito: `SUM(parcelas PENDENTES de DESPESA)` + nova compra não pode exceder `limite_total`; cartão é lockado (`FOR UPDATE`) para serializar transações concorrentes. Estouro dispara `FW429`.
- Pagamento de fatura (`processar_pagamento_fatura`): fatura vira `PAGA` e as parcelas filhas são baixadas em lote com `data_pagamento`; repagamento dispara `FW409`.
- Erros das RPCs carregam SQLSTATE estável (`FW400/401/404/409/429`) + `hint` com remediação — ver CLAUDE.md.

Após aplicar migrações, regenere `src/lib/database.types.ts`
(`npx supabase gen types typescript --project-id <id>`).

## Segurança

- **Least privilege no banco** (0005): clientes só leem (RLS por usuário);
  toda escrita passa por RPC `SECURITY DEFINER` com escopo por `auth.uid()`.
  DELETE físico é impossível (privilégio revogado + policies dropadas).
- **View com `security_invoker`**: consultas analíticas respeitam a RLS.
- **Headers HTTP** (`next.config.ts`): X-Frame-Options, nosniff,
  Referrer-Policy, Permissions-Policy.
- **Checklist do painel Supabase em produção**: reative **Confirm email**;
  configure **rate limits** de Auth (signup/signin); defina senha mínima >= 8;
  ative **PITR/backups** no plano; nunca exponha a `service_role` key no
  cliente (o app usa apenas a anon key + sessão).
