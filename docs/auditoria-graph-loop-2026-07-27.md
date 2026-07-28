# Relatório de Auditoria — graph-loop 2026-07-27

Branch: `audit/graph-loop-2026-07-27` (base `abdf913`). Escopo: os dois projetos de
`financeiro/` — `financeiro-web` (TypeScript + Postgres/Supabase) e
`financeiro-legado-desktop` (Python).

Metodologia: protocolo `graph-loop`. Gate de verificabilidade antes de qualquer
autonomia, fan-out por classe de defeito em contextos isolados, contrato de evidência
`arquivo:linha` + repro executado, e gate de correção em Red-Green — cada fix precisa
de um teste que **falha antes** e passa depois. Achado sem repro executado foi
classificado como não provado e **não** virou correção.

## Sumário executivo

| Projeto | Alto | Médio | Baixo | Corrigidos | Escalados |
|---|---|---|---|---|---|
| `financeiro-web` — TypeScript | 2 | 3 | 1 | 6 | 0 |
| `financeiro-web` — SQL | 1 | 3 | 2 | 6 | 0 |
| `financeiro-legado-desktop` | 7 | 6 | 2 | 15 | 6 |

| Gate | Baseline | Final |
|---|---|---|
| `npm test` | 91/91 | **104/104** |
| `npx tsc --noEmit` | limpo | **limpo** |
| Suíte SQL (19 migrations + 4 arquivos de asserts) | verde | **verde** |
| `test_suite.py` (legado) | **quebrado** — `ModuleNotFoundError: yfinance` | **19/19 PASS** |

`finance.db` do legado: MD5 `8329816927d829f06f27a3493c25bb92` idêntico antes e depois.
`backups/` intacto. Nenhum dado do usuário foi tocado.

---

## Ação pendente do usuário

**Rotacione a `GEMINI_API_KEY`.** A chave esteve em texto plano em
`financeiro-legado-desktop/.env`, numa pasta sem `.gitignore`, e `check_models.py`
imprimia seus 10 primeiros caracteres em stdout a cada execução. O valor no `.env` foi
preservado de propósito (você precisa dele para fazer a rotação), mas deve ser
considerado comprometido. Rotacione no Google AI Studio.

**Aplique a migration `0019`** no seu Supabase via `supabase/APLICAR_0017_0019.sql`.
As migrations `0017` e `0018` também nunca tinham entrado em nenhum bundle de
deploy — se o seu banco seguiu o processo documentado, ele está parado em `0016` e
sem o endurecimento de privilégios de `0017`. O `APLICAR.md` agora traz duas queries
read-only para descobrir em que ponto seu banco está.

---

## Achados — `financeiro-web`, camada TypeScript

### T-01 — Transbordo de mês em `cofrinhos.ts` (Alto · CWE-682)
- **Onde:** `src/lib/cofrinhos.ts:40-41` (`ritmoReal`) e `:76-78` (`dataProjetada`).
- **O quê:** `setUTCMonth` preserva o dia do mês. Quando o dia não existe no mês de
  destino, o `Date` transborda para o mês seguinte. Como a origem é o dia real do
  usuário em São Paulo, o resultado de "N meses à frente" muda conforme **que dia é
  hoje**, não conforme o negócio.
- **Repro executado:** `hoje=2026-01-29`, `+1 mês`, esperado `2026-02`, obtido `2026-03`.
  No mesmo cenário financeiro (falta R$1.000, ritmo R$400/mês), a projeção dá abr/2026
  se hoje é dia 28, 29 ou 30, e mai/2026 se hoje é dia 31 — um mês de diferença sem
  nenhuma mudança de dado.
- **Por que passou despercebido:** `tests/unit/cofrinhos.test.ts:13` fixa
  `HOJE = "2026-07-08"`. Os 91 testes verdes nunca exercitavam dia 29-31.
- **Fix:** `setUTCDate(1)` antes de `setUTCMonth`, nos dois pontos — o padrão que
  `mesesAte` no mesmo arquivo e `deslocarMes` em `insights.ts` já usavam. Commit `2290eee`.

### T-02 — ReDoS no parser de PDF (Alto · OWASP A05 · CWE-1333)
- **Onde:** `src/lib/pdf-extrato.ts:18-19`, `RE_VALOR_TOKEN`, 2ª alternativa.
- **O quê:** `-?\d+,\d{2}` — o `\d+` guloso sem vírgula garantida faz o motor tentar
  casar a partir de cada posição e retroceder caractere a caractere. Complexidade O(n²).
- **Repro executado:** n=25.000 → 192ms; n=50.000 → 779ms; n=100.000 → 3.078ms;
  n=200.000 → 12.295ms. Cada duplicação de entrada quadruplica o tempo.
- **Consequência:** `parsePdfExtrato` roda inteiro no navegador, sem worker e sem
  timeout. Um PDF disfarçado de extrato com uma linha de dígitos longa trava a aba. O
  `try/catch` existente protege contra exceção lançada, não contra travamento algorítmico.
- **Fix:** quantificador limitado a `\d{1,9}` e teto de 2.000 caracteres por linha antes
  de aplicar a regex. Tempo pós-fix na mesma entrada: 0,35ms. Commit `647aa62`.

### T-03 — `Math.round(n*100)` quebra o arredondamento prometido (Médio · CWE-681)
- **Onde:** `src/lib/money.ts:34-35`, `paraCentavosAssinado`.
- **O quê:** o comentário promete "arredonda ao centavo (meio para cima)", mas `n*100`
  em IEEE-754 não é exato: `0.145 * 100 = 14.499999999999998`, que arredonda para baixo.
- **Repro executado:** 658 falhas numa amostra de 14.286 valores no formato `X,XX5`.
  Exemplos: `0,145` → 14 (esperado 15), `1,265` → 126 (esperado 127), `2,175` → 217.
  O viés é sistemático para baixo, não ruído aleatório.
- **Por que passou despercebido:** o único teste de 3 casas decimais
  (`money.test.ts:46`, `"100,555"` → `10056`) usa por acidente um dos poucos valores
  exatamente representável em binário.
- **Consequência:** o campo "Valor (R$)" é texto livre em 7 componentes. Digitar 3 casas
  decimais num valor "azarado" grava 1 centavo a menos.
- **Fix:** a decisão de arredondamento passa a sair da **string** normalizada via
  `BigInt` (parte inteira + 2 decimais + 3º dígito decisor), sem depender de `n*100`.
  Round-trip de 0 a 999.999 centavos: 0 falhas. Commit `a34fddb`.

### T-04 — Teto de importação declarado e nunca aplicado (Médio)
- **Onde:** `src/lib/constantes.ts:21` + `src/components/importador-csv.tsx`.
- **O quê:** `LIMITE_LINHAS_IMPORTACAO = 1000` tem o comentário "espelha o teto do
  servidor" e zero usos em todo `src/`. `aoEscolherArquivo` só checava lista vazia.
- **Repro executado:** CSV sintético de 500.000 linhas (17,5 MB) aceito e parseado sem
  corte. 716ms, 152,9 MB de heap.
- **Fix:** `validarTetoLinhasImportacao` e `validarTamanhoArquivoImportacao` (funções
  puras em `csv.ts`) chamadas antes de `enviarStaging`, mais `LIMITE_BYTES_IMPORTACAO`
  de 10 MB checado antes de ler o arquivo. Commit `7dcffe5`.

### T-05 — Erro de categoria descartado (Médio · CWE-390)
- **Onde:** `src/components/nova-transacao-form.tsx:120-125`.
- **O quê:** único ponto do código-base que chama `supabase.rpc` sem desestruturar
  `{ error }`. Se `definir_categoria_transacao` falha, o erro some e o fluxo segue
  direto para o toast de sucesso.
- **Repro executado:** com mock cujo 2º RPC retorna erro, a única notificação disparada
  foi `sucesso: "Transação registrada: 1 parcela(s)."`.
- **Consequência:** a transação é criada certa, mas a categoria pode não ser aplicada —
  distorce envelope e orçamento por categoria sem nenhum sinal ao usuário.
- **Fix:** captura o erro e notifica sucesso parcial usando `mensagemDeErro` de
  `erros.ts`. Lógica extraída para `src/lib/nova-transacao.ts` para ser testável.
  Commit `a59d541`.

### T-06 — `hojeSaoPaulo()` duplicada 8 vezes (Baixo)
- **Onde:** `comando-menu.tsx:23`, `nova-transacao-form.tsx:14`, `transacoes/page.tsx:17`,
  `cofrinhos/page.tsx:13`, `dashboard/page.tsx:36`, `carteira-caixa.tsx:19`,
  `analise/page.tsx:15`, `faturas/page.tsx:23`.
- **O quê:** risco latente, não bug ativo — as 8 cópias são idênticas e corretas hoje.
  O projeto aplica fonte única com rigor a dinheiro (`money.ts`) mas não a esta função
  temporal central.
- **Fix:** extraída para `src/lib/data.ts`. Commit `5eeecf4`.

---

## Achados — `financeiro-web`, camada SQL

Provados contra PGlite (PostgreSQL 18.3 real compilado para WASM) com o shim de auth,
as 18 migrations e os 4 arquivos de verificação aplicados do zero.

### S-01 — `aplicar_recorrencias` travava o dashboard inteiro (Alto)
- **Onde:** `0008_categorias_e_regras.sql:248-259` (`excluir_categoria`) +
  `0015_recorrencias.sql:205-227` (`aplicar_recorrencias`).
- **O quê:** `excluir_categoria` cascateia soft-delete para `regras_categorizacao`, mas
  `recorrencias` foi criada depois (`0015`) e a cascata nunca foi revisitada. O
  `categoria_id` fica pendurado. `aplicar_recorrencias` chama
  `definir_categoria_transacao` dentro do loop sem bloco `exception`, o `FW404` aborta a
  transação inteira, e **nenhuma** recorrência materializa.
- **Repro executado:** duas recorrências vencidas, A com categoria e B sem relação
  nenhuma. Excluída a categoria de A: `excecao_propagou=t | A_materializou=f |
  B_materializou=f`. A recorrência B, alheia ao problema, também não materializou.
- **Consequência:** `aplicar_recorrencias` roda a cada carregamento do dashboard. Não
  existe RPC para editar recorrência. Uma ação normal do usuário (excluir uma categoria
  em uso) trava a materialização de todas as recorrências indefinidamente.
- **Fix:** os dois lados. `excluir_categoria` desvincula `recorrencias`, e o loop isola
  a falha por ocorrência num bloco `exception`, acumulando as falhas num `jsonb` de
  retorno sem avançar `proxima_data` da ocorrência que falhou. Pós-fix:
  `excecao_propagou=f | A_materializou=t | B_materializou=t`. Commit `37838dd`.

### S-02 — Lacuna de cobertura que deixou S-01 e S-04 passarem (Médio)
- **O quê:** 5 RPCs client-facing sem nenhum teste (`arquivar_cofrinho`,
  `atualizar_linha_importacao`, `descartar_importacao`, `editar_categoria`,
  `excluir_regra_categorizacao`). E `verificacao_isolamento.sql` só cobria
  `cartoes_credito`, `faturas`, `transacoes_origem` e `parcelas` — as 7 tabelas
  adicionadas depois têm a mesma policy mas nenhum assert direto.
- **Fix:** bloco H (as 5 RPCs, caminho feliz + `FW404`/`FW409`), bloco I (regressão
  S-01/S-04) e ISO-3 a ISO-9 (as 7 tabelas, padrão "usuário B tenta o id de A"). A suíte
  de isolamento foi de 5 para 18 asserts. Commit `6cdbf85`.

### S-03 — Nenhum bundle de deploy cobria `0017`/`0018` (Médio)
- **O quê:** `APLICAR.md` só menciona `0007`–`0012` e nem cita os bundles `0013`,
  `0014`, `0015_0016` que já existiam. Quem seguisse o processo documentado nunca
  aplicaria o endurecimento de privilégios de `0017` (revoga `SELECT` de `anon` em 11
  tabelas, teto monetário em 5 colunas) nem a guarda de `0018`.
- **Verificação:** os 6 bundles existentes batem byte-a-byte com as migrations que
  empacotam — não há drift de conteúdo, o problema é só de cobertura e documentação.
- **Fix:** `APLICAR_0017_0019.sql` (902 linhas, `diff` idêntico nos 3 segmentos) e
  `APLICAR.md` reescrito com todos os bundles, pré-requisitos e duas queries read-only
  de "onde meu banco está". Commit `9cc7ac8`.

### S-04 — Janela de competência inconsistente com a de vencimento (Médio)
- **Onde:** `0013_boletos.sql:107-113` e `:283-287`, `0014_estorno_recorrencia_cron.sql:210-217`.
- **O quê:** vencimento aceita até +5 anos, mas a competência **derivada por default**
  do vencimento é revalidada contra +1 ano. Todo vencimento a mais de ~12 meses viola o
  próprio limite, com erro citando um campo que o chamador nunca tocou.
- **Repro executado:** boleto com vencimento em 2028-01-27, sem competência explícita →
  `FW400: competência fora do intervalo plausível: 2028-01-01`. Pós-fix, criado com
  sucesso.
- **Consequência:** bloqueia caso de uso legítimo — seguro anual, IPVA, assinatura anual.
- **Fix:** teto da competência alinhado a +5 anos nas três funções. Commit `d41a887`.

### S-05 — Tetos anti-abuso sem lock (Baixo · TOCTOU)
- **Onde:** `criar_cartao` (`0005:85-92`), `criar_categoria` (`0008:164-169`),
  `criar_regra_categorizacao` (`0008:294-299`), `criar_cofrinho` (`0010:101-107`).
- **O quê:** `select count(*)` sem `for update` nem advisory lock. Sob READ COMMITTED,
  N chamadas paralelas do mesmo usuário podem todas ler a contagem antes de qualquer
  `INSERT` commitar e todas passarem no teto. Contrasta com o resto do código-base, que
  usa `for update` de forma consistente no padrão irmão de saldo e limite de crédito.
- **Fix:** `pg_advisory_xact_lock(hashtext('<rpc>:' || v_user_id))` antes do count, chave
  distinta por RPC. Commit `4451ec7`.
- **Limitação declarada:** a corrida real **não foi provada por execução**. PGlite é
  conexão lógica única e não abre duas transações simultâneas. Provado apenas que o lock
  não quebra o caminho feliz nem os tetos (FW429 no 21º cartão, no 31º cofrinho).

### S-06 — `current_date` sob TimeZone de sessão (Baixo)
- **Onde:** `0010_cofrinhos.sql:31`, `data date not null default current_date`.
- **O quê:** `CLAUDE.md` proíbe UTC implícito para regra de negócio. Supabase hospedado
  roda UTC por padrão; entre 21h e 23h59 em São Paulo, o UTC já virou o dia seguinte.
- **Estado:** hoje é código morto — os dois `INSERT` em `movimentacoes_cofrinho` passam
  `data` explícito. É mina latente para qualquer `INSERT` futuro que omita a coluna.
- **Repro executado:** o default variou entre `2026-07-27` e `2026-07-28` conforme o
  `TimeZone` da sessão. Pós-fix, constante nos três fusos testados.
- **Fix:** `set default ((now() at time zone 'America/Sao_Paulo')::date)`. Commit `20936b9`.

---

## Achados — `financeiro-legado-desktop`

O baseline aqui era **vermelho**: `test_suite.py` nem chegava a rodar um teste, porque
`import yfinance` no topo de `market_service.py` era puxado por `backend.py`. A suíte
final tem 19 asserções, todas passando.

### Bugs de correção silenciosa de dado

- **L-08 (Alto) — parcelamento era código morto.** `backend.py:38` comparava
  `payment_method == "Credit Card"`, mas a UI (`main.py:290`) só envia `"Crédito"`. A
  condição nunca era verdadeira. Repro: compra de R$1.200 em 12x gravava **1 linha** de
  R$1.200 na data da compra, não 12 parcelas. Toda previsão de fatura e fluxo de caixa
  saía errada. Pós-fix: 12 linhas de R$100, `installments_info` `1/12`..`12/12`.
- **L-10 (Alto) — parser não lia separador de milhar pt-BR.** `smart_parser.py:35`. Repro:
  `"Mercado 1.500,50"` era registrado como **R$1,00**. Um gasto enviado pelo Telegram
  perdia 99,9% do valor, sem erro nem aviso.
- **L-07 (Alto) — parcelas perdiam centavos.** `round(amount/installments, 2)` aplicado a
  todas as parcelas. Repro: R$100 em 3x somava R$99,99. Fix: divisão em centavos
  inteiros com o resto distribuído nas últimas parcelas, convenção de operadora.
- **L-16 (Alto) — uma célula ruim abortava o import inteiro.** `backend.py:220-227`. Repro:
  CSV de 3 linhas com a 2ª inválida importava só a 1ª — a 3ª linha, válida, era
  descartada sem aviso. Fix: linhas inválidas são puladas e contadas, o resto do arquivo
  continua.

### Segurança

- **L-12 (Alto) — bot do Telegram fail-open.** `simple_bot.py:108`: a checagem só
  bloqueava **se** `TELEGRAM_USER_ID` já estivesse configurado. Não está no `.env` atual.
  Com o token configurado, qualquer pessoa que descobrisse o bot teria leitura e escrita
  sobre os dados financeiros. Fix: `is_authorized()` fail-closed — sem `allowed_user_id`
  configurado, ninguém é autorizado, mais aviso no startup.
- **L-15 (Alto) — formula injection no export Excel** (CWE-1236). Repro: descrição
  `=cmd|'/c calc'!A1` vinda de um CSV importado virava fórmula real no `.xlsx`
  (`data_type=f` confirmado via openpyxl). Fix: `_excel_safe()` prefixa aspa simples em
  célula que comece com `=`, `+`, `-`, `@`, TAB ou CR.
- **L-06 (Alto) — SQL injection** em `database.py:134`. Repro: payload
  `UNION SELECT` executado com sucesso contra cópia do banco. Hoje não há caminho de UI
  que alimente a função com string do usuário — é defesa em profundidade. Fix: queries
  parametrizadas mais `int()` nos parâmetros.
- **L-01 a L-05 (Alto/Médio) — segredos.** `.gitignore` criado cobrindo `.env`, `*.db`,
  `backups/`, `__pycache__`. Removidos: `API_KEY[:10]` de `check_models.py:12`,
  `TOKEN[:5]` de `simple_bot.py:90`, 3 prints DEBUG de `ai_agent.py:25-27`, e o
  preenchimento automático da chave no widget de UI (`main.py:58-59` — `show="*"` mascara
  a exibição, mas o valor puro fica no widget e sai por `.get()`).

### Robustez

- **L-09 (Médio)** — `date('now')` do SQLite opera em UTC enquanto o resto do app usa
  hora local; desloca o corte de "últimos 3 meses" em até 1 dia entre 21h e 23h59.
  Diferença de 3h confirmada por execução. Corte agora é calculado em Python e passado
  como parâmetro.
- **L-11 (Médio)** — `import yfinance` no topo de `market_service.py` quebrava a suíte
  inteira. Movido para dentro de `get_quotes()` com fallback.
- **L-13 (Médio)** — `requests` sem `timeout` no bot: rede instável pendura o loop para
  sempre, sem crash e sem log. `timeout=40` no polling (maior que os 30s do long-poll) e
  `timeout=10` no envio.
- **L-17 (Médio)** — cliente Gemini sem timeout. Descoberto por execução que a unidade de
  `HttpOptions(timeout=...)` é **milissegundos**, não segundos. Configurado 30000.
- **L-14 (Baixo)** — 5 `except:` nus removidos, com log de diagnóstico onde não havia.
- **L-18** — achado negativo: as 16 conexões SQLite seguem `connect`/`commit`/`close`
  local, nenhuma compartilhada entre threads. Nenhum identificador concatenado em query.

### Escalados — decisão sua, não aplicados

- **E-01** — `amount` é `REAL` (float) em todo o schema. Migrar para centavos inteiros ou
  `Decimal` exige alterar o schema de um banco com dados reais e tocar UI, export e
  import. O ponto de maior impacto concreto (parcelamento) já foi corrigido.
- **E-02** — `verify_fixes.py` instancia `FinanceController()` com o banco **real** e
  chama `check_and_generate_recurring()`, que grava. Não foi executado nem alterado.
- **E-03** — o loop de parcelamento abre uma conexão por parcela; queda no meio deixa
  resultado parcial sem rollback. Corrigir exige repensar o gerenciamento de transação de
  `DatabaseManager` inteiro.
- **E-04** — `SmartParser` força valor negativo sempre; o bot nunca consegue registrar
  receita. Comportamento intencional do autor, mas é limitação de produto.
- **E-05** — `dayfirst=True` no import: planilha em formato americano é mal interpretada
  sem erro para dias ≤ 12.
- **E-06** — `abs(unassigned) < 1.0` como tolerância de "orçamento zerado". R$1,00 é muito
  maior que qualquer erro de float justificaria; parece escolha de UX.

---

## Lacunas desta auditoria

Declaradas em vez de escondidas:

- **Corrida real de concorrência** (S-05, e validação dos `for update` existentes) não é
  reproduzível: `psql` e Postgres de sistema indisponíveis no ambiente, `apt-get` e
  `sudo` negados. PGlite é conexão lógica única.
- **`npm run build`** e **`npm run test:sql`** (runner Docker oficial do repo) não foram
  executados aqui. Os gates cobertos foram `npm test`, `tsc --noEmit` e a suíte SQL via
  PGlite.
- **GUI do legado** não roda no ambiente (sem display, sem `customtkinter`). As correções
  em `main.py` foram validadas por leitura da cadeia completa de chamadas e AST. Vale
  abrir o app uma vez para confirmar que o campo de chave aparece vazio e que o
  parcelamento gera as parcelas certas.
- **Estado real da plataforma Supabase** (roles, `BYPASSRLS`, timezone da instância,
  `pg_cron` em produção) não é verificável a partir do código-fonte. A conclusão sobre
  `TimeZone=UTC` em S-06 usa o default documentado da Supabase.
- **Documento-fonte da "auditoria de banco Fase 1, 2026-07-22"**, citada nos comentários
  de `0017`/`0018`, não está em `docs/` e o `memory/state.json` não foi atualizado depois
  de 2026-07-05. Só há rastro dos achados #2/#4/#5/#7 nos comentários das próprias
  migrations. Não sei se #1/#3/#6/#8 existem ou ficaram pendentes.
- **`pdfjs-dist` com PDF binário adversário** (bombas de descompressão, streams
  corrompidos) não foi testado. T-02 cobre a camada de regex, não o parser de PDF em si.

## Regressões da auditoria anterior

Nenhuma. `A-01` (CSP em `next.config.ts`) íntegra e commitada; `A-06` (`error.tsx` sem
vazar stack) presente. `CON-02` (filtros `user_id` de defesa em profundidade nas funções
`SECURITY DEFINER`), pisos temporais `2000-01-01`, `fn_touch_updated_at` com
`clock_timestamp()` e `fechar_faturas` respeitando soft-delete: todos confirmados sem
regressão, os últimos por execução.

---

Registro estruturado em `memory/state.json`, namespace `auditoria`, chave
`graph_loop_2026_07_27`. Veredito: `APROVADO_COM_ACAO_PENDENTE` — a pendência é a
rotação da chave e a aplicação da migration `0019`, ambas ações do usuário.
