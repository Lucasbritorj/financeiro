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
2. No **SQL Editor**, execute na ordem:
   - `supabase/migrations/0001_nucleo_transacional.sql` (tabelas, índices, RLS, cascata de soft delete)
   - `supabase/migrations/0002_processar_transacao_completa.sql` (motor de parcelamento)
3. (Opcional) Execute `supabase/tests/verificacao_nucleo.sql` — roda 5 asserts
   (divisão centesimal, Falha do Dia 31, corte de fechamento, idempotência de
   faturas, fluxo não-crédito) e termina em `ROLLBACK`, sem persistir nada.
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
