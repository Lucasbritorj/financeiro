@AGENTS.md

# CLAUDE.md — financeiro-web

Regras inflexíveis deste projeto. Em conflito com hábito de outro codebase, este arquivo ganha.

## Stack

- **Next.js 16** (App Router). Sessão renovada e rotas protegidas via `src/proxy.ts`
  (o Next 16 renomeou `middleware` para `proxy` — não crie `middleware.ts`).
- **Supabase**: PostgreSQL + Auth + RLS. Leitura do frontend passa pela RLS; escrita, por RPC.

## Convenção monetária (inviolável)

- Valores monetários são **inteiros em centavos** (`bigint`) no banco, nas RPCs e em
  qualquer lógica de negócio. Moeda BRL. Nada de aritmética financeira em float.
- Conversão decimal ↔ centavos só na borda do frontend, via `src/lib/money.ts`:
  `paraCentavos` na UI (só positivo; `NaN` se <= 0) e `paraCentavosAssinado` na importação
  (com sinal). Não reimplemente parser em outro arquivo.
- O hook `.claude/hooks/invariantes-guard.js` barra `Math.round(x*100)` e
  `(x/100).toFixed|toLocaleString` em `src/**/*.ts(x)` fora de `money.ts` e de teste. Ele só
  inspeciona Edit e Write (MultiEdit e shell passam sem checagem): edite `src/` por Edit/Write.
  Percentual também dispara: use `fmtPct` (`analise-obs.ts`) ou `variacaoPercentual`
  (`insights.ts`), ou Edit pontual sem o padrão; nunca contorne pelo shell.

## Timezone

- Fuso de negócio: **`America/Sao_Paulo`**, obrigatório para dia de fechamento, competência
  e data de compra. Nunca use o fuso do servidor ou UTC implícito para regra de negócio.
- No SQL, "hoje" é `(now() at time zone 'America/Sao_Paulo')::date`, nunca `current_date`
  (depende do `TimeZone` da sessão). No cliente, use `hojeSaoPaulo()` (`src/lib/data.ts`) e
  `mesCorrenteSaoPaulo()` (`src/lib/dashboard-dados.ts`); não derive dia ou mês de
  `new Date()` local. O hook barra `from 'date-fns|dayjs|luxon|moment'` (especificador
  exato) sem `America/Sao_Paulo` no mesmo trecho.

## Arquitetura de escrita

- Escrita direta é **revogada no banco**: `authenticated` só tem `SELECT` nas tabelas e
  `anon` nenhum privilégio (0005, 0017, 0022); DML direto falha com `42501`. Nunca reconceda
  DML a essas roles. O default privilege de `public` ainda concede DML e SELECT a ambas
  (0022), então objeto novo revoga na própria migration:
  - tabela: revoga DML das duas e SELECT de `anon`, liga RLS com policy por `auth.uid()` e
    cria `trg_touch_updated_at` (`clock_timestamp()`, porque `now()` congela no início da
    transação; não setar `updated_at` à mão);
  - view: `security_invoker = true` (senão roda com privilégio do dono e vaza dados entre
    usuários), `revoke all ... from public, anon` e `grant select ... to authenticated`.
- Toda lógica de escrita relacional é delegada a **funções RPC atômicas**. Núcleo:
  - `processar_transacao_completa` — compra/receita, parcelamento, guard de limite, teto
    de 120 parcelas, trava FW409 em fatura PAGA/FECHADA, sanidade temporal FW400.
  - `processar_pagamento_fatura` — fatura e parcelas → `PAGA`; `estornar_pagamento_fatura`
    (0014) desfaz. `fechar_faturas` — ABERTA → FECHADA no corte; administrativa (nenhum role
    de cliente executa), agendada pela 0014 no pg_cron (`fechar-faturas-diario`); não crie
    outro job (o passo 4 do Setup do README está desatualizado).
  - `excluir_transacao` — soft delete com cascata; parcela PAGA bloqueia (FW409: histórico
    se estorna, não se apaga). `excluir_cartao` — parcelas pendentes bloqueiam (FW409).
    `criar_cartao` — validações + teto de 20 cartões ativos.
- Regras do núcleo (asserts em `supabase/tests/verificacao_nucleo.sql`; o `FOR UPDATE` e a
  RECEITA fora do limite só existem no código, 0002): parcela = `floor(total/n)`, resto na
  1ª. Dia >= `dia_fechamento` cai na competência seguinte; dia inexistente no mês vira o
  último, nunca rola (Dia 31); vencimento no mês seguinte se `dia_vencimento <=
  dia_fechamento`. Limite: parcelas `PENDENTE` ativas de DESPESA mais o novo valor acima de
  `limite_total` dão FW429 (cartão em `FOR UPDATE`; RECEITA não conta). Fatura ABERTA pode
  ser paga direto (antecipação). Compra/pagamento: 2000-01-01 até amanhã.
- RPCs de escrita são `SECURITY DEFINER` com `set search_path = ''` e por isso **bypassam a
  RLS**: toda query interna filtra/insere `user_id = auth.uid()`, e o usuário nunca vem de
  parâmetro do cliente. Nova RPC repete o padrão, com revoke execute de `public`/`anon` e
  grant a `authenticated` (interna revoga também de `authenticated`). Teto anti-abuso usa
  `pg_advisory_xact_lock` por usuário antes do `count` (0019).
- Lote: `aplicar_recorrencias` isola falha por ocorrência (0019); `confirmar_importacao` é
  atômica — colisão aborta o lote inteiro com FW409. Não troque um padrão pelo outro.
- Totais de fatura vêm da view `vw_faturas_consolidadas`. RECEITA (estorno) abate; parcelas
  guardam valor absoluto, o sinal vive na view.
- Erros de RPC: SQLSTATE estável + `hint` acionável. `FW400` input inválido · `FW401` não
  autenticado · `FW404` não encontrado · `FW409` estado conflitante · `FW429` limite
  excedido · `FW500` integridade. `RAISE` novo usa `errcode` + `hint`; o front exibe ambos.
- Enforcement: `npm test` roda os gates de `tests/gate/` contra as migrations reais (RLS e
  policy com `auth.uid()`, view `security_invoker`, DEFINER com `search_path = ''`,
  privilégio de execute) e `readme-migracoes` (toda migration citada no README).

## Soft delete

- **Nunca** executar `DELETE` físico: policies de DELETE dropadas e privilégio revogado
  (0005). Exclusão = setar `deleted_at` via RPC; a cascata transação → parcelas é do
  trigger `trg_transacao_soft_delete`, não replique em código de aplicação.
- Toda query de leitura e todo índice único novo devem ter `WHERE deleted_at IS NULL`
  (exceção histórica: `parcelas_transacao_numero_uk`, 0001). `ON CONFLICT` em índice
  parcial repete o predicado: `on conflict (...) where deleted_at is null`.

## Schema e migrações

- `supabase/migrations/` é a fonte da verdade. Migration nova nasce com
  `supabase migration new`, é citada pelo nome completo no Setup do README e aplicada em
  ordem alfabética do nome (`00NN_`, depois `YYYYMMDDHHMMSS_`). Alterou schema: regenere
  `src/lib/database.types.ts` (`npx supabase gen types typescript --project-id <id>`).
- Valide local com `npm run test:sql` (Postgres 17 efêmero em Docker): aplica tudo e roda
  todos os arquivos de `supabase/tests/` (glob). Cada um termina em `ROLLBACK` e emite o
  notice `OK: N/N asserts`, senão a suíte fica vermelha. Alterou regra de negócio no SQL:
  adicione/ajuste o assert correspondente. O CLI local está linkado à produção
  (`supabase db push`/`config push` a atingem direto); não presuma o remoto em dia.

## Qualidade e entrega

- `npm run gate` espelha o job `node` do CI e para na primeira falha (mudou esse job no
  `ci.yml`, mude `tests/gate/etapas.ts`). O CI roda `node`, `e2e`, `lighthouse` e `sql`;
  `npm run smoke -- <url>` é pós-deploy. Mudança em dinheiro, schema, RPC, RLS ou auth só
  vai para revisão com `npm run gate` e `npm run test:sql` verdes (ou CI verde).
- Antes de merge em master, revisão sobre o diff e este arquivo, sem aproveitar o raciocínio
  do autor: skill `code-review`; se tocar RLS, auth ou RPC, peça também `/security-review`
  ao Lucas (comando dele, não skill). Veredito binário, na dúvida rejeita; achado cita
  `arquivo:linha` e correção testável, e confere centavos/reais e fuso na borda. Correção
  restrita aos achados, no máximo 3 rodadas; depois, ou com o mesmo achado reprovado 2
  vezes, pare e escale ao Lucas com achados, commits e saídas de teste.
- Falha em escrita com efeito (migration, RPC em banco, deploy, push): leia o estado real
  antes de repetir, porque pode ter aplicado em parte. Erro de permissão não se repete.
- Regra de negócio confirmada vira invariante aqui + assert em `supabase/tests` ou gate em
  `tests/unit`. `.claude/agent-core/` e `memory/` são legado do antigravity-core: não siga,
  não atualize, não cite como fonte.
