@AGENTS.md

# CLAUDE.md — financeiro-web

Regras inflexíveis deste projeto. Elas prevalecem sobre qualquer preferência de estilo
ou hábito de outro codebase. Em conflito, este arquivo ganha.

## Stack

- **Next.js 16** (App Router). Sessão renovada e rotas protegidas via `src/proxy.ts`
  (o Next 16 renomeou `middleware` para `proxy` — não crie `middleware.ts`).
- **Supabase**: PostgreSQL + Auth + RLS. Toda leitura do frontend passa pela RLS;
  toda escrita relacional passa por RPC (ver Arquitetura de Escrita).

## Convenção monetária (inviolável)

- Valores monetários são **inteiros em centavos** (`bigint`) no banco, nas RPCs e em
  qualquer lógica de negócio. Moeda BRL.
- Conversão para decimal/float acontece **apenas na borda do frontend**
  (`src/lib/money.ts`). Proibido aritmética financeira em float em qualquer camada.

## Timezone

- Fuso de negócio: **`America/Sao_Paulo`**, obrigatório para dia de fechamento,
  competência e data de compra. Nunca use o fuso do servidor ou UTC implícito
  para regra de negócio.

## Arquitetura de escrita

- Escrita direta é **revogada no banco** (0005): `authenticated`/`anon` só têm
  `SELECT`; INSERT/UPDATE/DELETE diretos falham com `42501`. Não é convenção —
  é enforcement. Nunca reconceda DML direto a essas roles.
- Toda lógica de escrita relacional (transações, parcelas, faturas, pagamento,
  cartões, deleção lógica) é delegada a **funções RPC atômicas** no PostgreSQL:
  - `processar_transacao_completa` — compra/receita, parcelamento, guard de
    limite, teto de 120 parcelas, trava FW409 em fatura PAGA/FECHADA,
    sanidade temporal FW400.
  - `processar_pagamento_fatura` — máquina de estados fatura/parcelas → `PAGA`.
  - `criar_cartao` — validações + teto de 20 cartões ativos.
  - `excluir_transacao` — soft delete com cascata; parcela PAGA bloqueia (FW409:
    histórico se estorna, não se apaga).
  - `excluir_cartao` — soft delete; parcelas pendentes bloqueiam (FW409).
  - `fechar_faturas` — ABERTA → FECHADA no corte da competência; administrativa
    (nenhum role de cliente executa; agendar no pg_cron).
- `updated_at` é mantido por trigger genérico (`trg_touch_updated_at`, 0006)
  nas 4 tabelas — não setar à mão em RPC nova.
- RPCs são `SECURITY DEFINER` com `set search_path = ''`; por isso **bypassam a
  RLS** — toda query interna DEVE filtrar/inserir `user_id = auth.uid()`
  explicitamente. Usuário nunca vem de parâmetro do cliente. Nova RPC de
  escrita: repetir o padrão completo (definer + search_path + escopo em código
  + revoke execute de `public`/`anon` + grant a `authenticated`).
- Totais de fatura são lidos da view `vw_faturas_consolidadas`
  (`security_invoker = true` — obrigatório em toda view nova, senão a view
  roda com privilégio do dono e vaza dados entre usuários). RECEITA (estorno)
  abate; parcelas guardam valor absoluto, o sinal vive na view.
- Erros de RPC usam SQLSTATE estável + `hint` com remediação acionável:
  `FW400` input inválido · `FW401` não autenticado · `FW404` não encontrado ·
  `FW409` estado conflitante (ex.: fatura já paga) · `FW429` limite excedido ·
  `FW500` falha interna de integridade.
  Novo `RAISE` em RPC deve seguir o padrão (`using errcode = ..., hint = ...`).
  Frontend exibe `error.message` + `error.hint`.

## Soft delete

- **Nunca** executar `DELETE` físico — as policies de DELETE foram dropadas
  (0005) e o privilégio revogado: clientes não conseguem nem tentando.
  Exclusão = setar `deleted_at` (via RPC).
- Toda query de leitura e todo índice único devem ter `WHERE deleted_at IS NULL`
  (ex.: `faturas_ativas_cartao_competencia_idx`).
- `ON CONFLICT` que mira índice parcial precisa do predicado:
  `on conflict (...) where deleted_at is null`.
- Cascata transação → parcelas é responsabilidade do trigger
  `trg_transacao_soft_delete`; não replique em código de aplicação.

## Schema e tipos

- `supabase/migrations/` é a fonte da verdade do schema; migrações são aplicadas em
  ordem numérica no SQL Editor. Alterou schema: regenere `src/lib/database.types.ts`
  (`npx supabase gen types typescript --project-id <id>`).
- `supabase/tests/verificacao_nucleo.sql` roda os asserts do núcleo e termina
  em `ROLLBACK`. Alterou regra de negócio no SQL: adicione/ajuste assert
  correspondente.

## Governança do agente (antigravity-core)

Protocolos completos em `.claude/agent-core/GOVERNANCA.md`. Resumo operacional:

1. **protocolo_de_erro (tool-contract/1.0)** — toda ferramenta de ação retorna
   envelope JSON com `status`. Só use `data` se `status == "ok"`;
   `data_is_empty: true` = vazio real (nunca preencher com dado plausível);
   retry decidido pelo campo `category`; falha reportada com `error_code`,
   `category`, `attempts`, `trace_id` e próximo passo.
2. **memória de estado (state-memory/1.0)** — estado durável em `memory/state.json`
   via `.claude/agent-core/state_memory_tool.py` (`index` → `read` cirúrgico →
   `upsert` in-place). Regras de negócio confirmadas vivem no namespace
   `regras_negocio`. Chat não é memória; segredos nunca entram no store.
3. **Watchdog (audit-verdict/1.0)** — artefato de dados não entra em produção por
   autoaprovação: gate determinístico + auditoria em contexto limpo com
   `.claude/agent-core/watchdog/WATCHDOG_PROMPT.md`. Veredito registrado no
   namespace `auditoria`. Máximo 3 iterações; depois, escalar ao usuário.
