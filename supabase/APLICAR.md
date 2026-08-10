# Como deixar o projeto 100% funcional

As funcionalidades do assistente (categorias, importação, cofrinhos, análise,
edição completa de transação, carteira/regime de caixa, boletos, estorno,
recorrências) e o endurecimento de segurança/auditoria mais recente exigem
aplicar as migrations `0007`–`0019` no seu Supabase, em ordem. O núcleo
(`0001`–`0006`: transações, faturas, cartões) já está em produção — ver
`memory/state.json` (`producao.infra`) — e não precisa ser reaplicado.

## Passo 1 — Aplicar as migrations (obrigatório, ~2 min)

**Opção A — SQL Editor (mais simples):**
1. Abra o painel do seu projeto no Supabase → menu **SQL Editor** → **New query**.
2. Cole o conteúdo inteiro do bundle certo para o seu caso (ver tabela abaixo).
3. Clique **Run**. Deve terminar sem erro (`Success. No rows returned`).
4. Repita para o próximo bundle da sequência, em ordem.

**Opção B — Supabase CLI (se você tem a senha do banco):**
```bash
supabase link --project-ref SEU_PROJECT_REF
supabase db push        # aplica supabase/migrations/*.sql pendentes, em ordem
```

**Opção C — psql direto (connection string com senha):**
```bash
psql "postgresql://postgres:SENHA@db.SEU_REF.supabase.co:5432/postgres" \
  -f supabase/APLICAR_0017_0019.sql   # troque pelo bundle certo (ver tabela abaixo)
```

> Rode cada bundle **uma vez só**. A maioria das migrations cria tabelas com
> `create table` (sem `if not exists`) — reexecutar um bundle que contenha
> `create table` para algo que já existe dá erro de objeto já existente.
> Exceção: **`APLICAR_0017_0019.sql` é seguro para reexecutar** (só
> `create or replace function`, `drop ... if exists` + `add`, e
> `alter column ... set default` — nenhum `create table`).
> Se precisar recomeçar do zero, aplique num banco limpo.

### Nunca apliquei nada além do núcleo (0001-0006) — sequência completa

Rode nesta ordem (pule o que já tiver aplicado):

1. [`APLICAR_0007_0012.sql`](./APLICAR_0007_0012.sql) — cobre `0007`–`0012`.
2. [`APLICAR_0013.sql`](./APLICAR_0013.sql) — cobre `0013`.
3. [`APLICAR_0014.sql`](./APLICAR_0014.sql) — cobre `0014`.
4. [`APLICAR_0015_0016.sql`](./APLICAR_0015_0016.sql) — cobre `0015`–`0016`.
5. [`APLICAR_0017_0019.sql`](./APLICAR_0017_0019.sql) — cobre `0017`–`0019`
   (endurecimento de privilégios, guarda de importação e as correções da
   auditoria graph-loop de 2026-07-27: recorrências não travam mais o
   dashboard quando a categoria delas é excluída, competência de boleto
   aceita a mesma janela do vencimento, tetos anti-abuso com lock, timezone
   explícito no default de cofrinho). **Mais recente — se você só quer
   aplicar isto, confirme antes que `0001`–`0016` já estão aplicadas.**

### Tabela de todos os bundles (ordem, cobertura, pré-requisito)

| Bundle / arquivo | Cobre | Pré-requisito | Observação |
|---|---|---|---|
| `migrations/0001`…`0006` (individuais) | `0001`–`0006` | banco limpo | núcleo transacional; já aplicado em produção, normalmente não precisa rodar de novo |
| [`APLICAR_0007_0012.sql`](./APLICAR_0007_0012.sql) | `0007`–`0012` | `0001`–`0006` | bundle histórico da 1ª leva do assistente (categorias, importação, cofrinhos, edição completa, carteira) |
| [`APLICAR_0011_0012.sql`](./APLICAR_0011_0012.sql) | `0011`–`0012` | `0001`–`0010` | **alternativa** ao passo 1 acima só para quem já tinha `0007`–`0010` aplicadas antes de `0011`/`0012` existirem — não rode se já rodou `APLICAR_0007_0012.sql` |
| [`APLICAR_0013.sql`](./APLICAR_0013.sql) | `0013` | `0001`–`0012` | boletos |
| [`APLICAR_0014.sql`](./APLICAR_0014.sql) | `0014` | `0001`–`0013` | estorno de pagamento + recorrência de boleto + agendamento de `fechar_faturas` |
| [`APLICAR_0011_0014.sql`](./APLICAR_0011_0014.sql) | `0011`–`0014` | `0001`–`0010` | **atalho consolidado** — equivale a rodar `APLICAR_0011_0012.sql` + `APLICAR_0013.sql` + `APLICAR_0014.sql` num arquivo só; não rode se já aplicou qualquer um dos três individualmente |
| [`APLICAR_0015_0016.sql`](./APLICAR_0015_0016.sql) | `0015`–`0016` | `0001`–`0014` | recorrências + mais formatos de importação (OFX/OFC/XLSX/PDF) |
| [`APLICAR_0017_0019.sql`](./APLICAR_0017_0019.sql) | `0017`–`0019` | `0001`–`0016` | **novo** — endurecimento de privilégios, guarda de valor da importação, correções da auditoria graph-loop (2026-07-27). Seguro para reexecutar. |

> **Já aplicou tudo até uma migration específica?** Rode só o que falta, na
> ordem da tabela acima. Para saber onde você está, no SQL Editor (consultas
> só de leitura, não alteram nada):
> ```sql
> select proname from pg_proc
>  where pronamespace = 'public'::regnamespace
>    and proname in ('aplicar_recorrencias', 'criar_boleto');
> -- 'aplicar_recorrencias' presente => 0015 já aplicada.
> -- 'criar_boleto' presente => 0013 já aplicada.
>
> select pg_get_functiondef('public.excluir_categoria(uuid)'::regprocedure)
>          like '%recorrencias_afetadas%' as tem_fix_0019;
> -- true => 0019 já aplicada (excluir_categoria já desvincula recorrências).
> ```

## Passo 2 — Semear categorias (por usuário, no app)

Logado, o Dashboard ou a página **Categorias** mostram o botão
**"Criar categorias padrão"** para quem ainda não tem nenhuma. Um clique cria
o conjunto Ateliê (Moradia, Mercado, Delivery…) + regras de comerciante
(IFOOD→Delivery, UBER→Transporte etc.). Não precisa de SQL.

## Passo 3 — Usar

- **Transações** → lançar (com categoria automática pela regra) / editar / paginar.
- **Importar** → subir CSV/OFX/OFC/XLSX/PDF do banco, revisar duplicadas, confirmar em lote.
- **Cofrinhos** → criar meta, aportar/resgatar, ver anel e status.
- **Boletos** → lançar conta a pagar com vencimento, pagar, estornar, duplicar para o mês seguinte.
- **Recorrências** → cadastrar despesa/receita fixa (aluguel, salário); materializa sozinha ao abrir o dashboard.
- **Análise** → leitura determinística dos gastos/ganhos (tendências, envelopes,
  concentração, recorrentes). Também aparece um destaque no Dashboard.

## Verificar antes de aplicar em produção (opcional)

Com Docker rodando, a suíte reproduz o banco do zero (shim de auth +
`migrations/*.sql` em ordem + os 4 arquivos de `supabase/tests/*.sql`) e
valida tudo — verde é `SQL SUITE VERDE` no final:
```bash
bash tests/sql/run_local.sh
npm test                        # testes de lógica pura (TypeScript)
npm run build                   # tipos + lint
```
Sem Docker disponível, o mesmo shim + as mesmas migrations + os mesmos 4
arquivos de teste rodam sobre `@electric-sql/pglite` (PostgreSQL real
compilado para WASM, processo Node local, sem serviço externo) — é como
esta auditoria (graph-loop, 2026-07-27) provou os fixes de `0019` por
execução real antes de commitar.

## Notas

- `src/lib/database.types.ts` já reflete o schema novo (editado à mão). Ao
  aplicar, opcionalmente regenere com
  `npx supabase gen types typescript --project-id SEU_REF > src/lib/database.types.ts`.
- Deploy (Vercel): faça merge/push da branch de trabalho para a branch de deploy.
- Segurança preservada: toda tabela nova entra no mesmo regime (RLS por
  `user_id`, DML direto revogado, escrita só por RPC `SECURITY DEFINER`).
  `0017` reforça esse regime (revoga `SELECT` de `anon` nas tabelas de base,
  remove policies de INSERT/UPDATE mortas, teto superior nas colunas
  monetárias); `0019` fecha o resto do gap: `excluir_categoria` desvincula
  `recorrencias`, `aplicar_recorrencias` isola falha por ocorrência, tetos
  anti-abuso ganham `pg_advisory_xact_lock`.
