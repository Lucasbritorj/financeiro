# Como deixar o projeto 100% funcional

As funcionalidades novas (categorias, importação, cofrinhos, análise) exigem
aplicar as migrations `0007`–`0010` no seu Supabase. O que já existia
(transações, faturas, cartões) continua funcionando sem isso.

## Passo 1 — Aplicar as migrations (obrigatório, ~2 min)

**Opção A — SQL Editor (mais simples):**
1. Abra o painel do seu projeto no Supabase → menu **SQL Editor** → **New query**.
2. Cole o conteúdo inteiro de [`APLICAR_0007_0010.sql`](./APLICAR_0007_0010.sql)
   (bundle das 4 migrations, já na ordem correta).
3. Clique **Run**. Deve terminar sem erro (`Success. No rows returned`).

> Rode **uma vez só**. As migrations criam tabelas/funções — reexecutar dá erro
> de objeto já existente. Se precisar recomeçar, aplique num banco limpo.

**Opção B — Supabase CLI (se você tem a senha do banco):**
```bash
supabase link --project-ref SEU_PROJECT_REF
supabase db push        # aplica supabase/migrations/*.sql pendentes
```

**Opção C — psql direto (connection string com senha):**
```bash
psql "postgresql://postgres:SENHA@db.SEU_REF.supabase.co:5432/postgres" \
  -f supabase/APLICAR_0007_0010.sql
```

## Passo 2 — Semear categorias (por usuário, no app)

Logado, o Dashboard ou a página **Categorias** mostram o botão
**"Criar categorias padrão"** para quem ainda não tem nenhuma. Um clique cria
o conjunto Ateliê (Moradia, Mercado, Delivery…) + regras de comerciante
(IFOOD→Delivery, UBER→Transporte etc.). Não precisa de SQL.

## Passo 3 — Usar

- **Transações** → lançar (com categoria automática pela regra) / editar / paginar.
- **Importar** → subir CSV do banco, revisar duplicadas, confirmar em lote.
- **Cofrinhos** → criar meta, aportar/resgatar, ver anel e status.
- **Análise** → leitura determinística dos gastos/ganhos (tendências, envelopes,
  concentração, recorrentes). Também aparece um destaque no Dashboard.

## Verificar antes de aplicar em produção (opcional)

Com Docker rodando, a suíte reproduz o banco do zero e valida tudo:
```bash
bash tests/sql/run_local.sh     # 21 asserts do núcleo + 20 do assistente
npm test                        # 48 testes de lógica pura
npm run build                   # tipos + lint
```

## Notas

- `src/lib/database.types.ts` já reflete o schema novo (editado à mão). Ao
  aplicar, opcionalmente regenere com
  `npx supabase gen types typescript --project-id SEU_REF > src/lib/database.types.ts`.
- Deploy (Vercel): faça merge/push da branch `feat/assistente-financeiro`.
- Segurança preservada: toda tabela nova entra no mesmo regime (RLS por
  `user_id`, DML direto revogado, escrita só por RPC `SECURITY DEFINER`).
