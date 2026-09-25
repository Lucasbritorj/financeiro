# Validação local do Financeiro — 25/09/2026

Base desta rodada: 3bdde3e, branch codex/consolidacao-financeiro.
Escopo: cópia Codex; sem push, deploy, acesso ao banco remoto ou alteração no Claude.

## Resultado

| Verificação | Resultado |
|---|---|
| Instalação pelo lockfile, npm 11.17.0 | Passou, com --ignore-scripts |
| Sincronia package.json/lockfile | Passou |
| TypeScript | Passou, também durante build |
| ESLint | Zero erros; dez avisos de complexidade/tamanho |
| Unitários | 483 passaram |
| Componentes | 93 passaram, em sete arquivos; ressalva de inicialização abaixo |
| PostgreSQL 17 local | Todas as migrações + 9/9 arquivos de asserts passaram |
| Build Next.js 16.3.6 | Passou |
| Playwright Chromium | 16 passaram, zero retries |
| Smoke PWA | 3/3: sw.js, sw-rotas.js e manifest |
| npm audit produção | Zero entradas de vulnerabilidade conhecida |
| npm audit completo | 9 entradas restantes: 7 altas e 2 baixas, cadeia do Lighthouse |

Playwright cobriu /login em 320, 768, 1024 e 1440px: renderização, teclado,
axe sem violações graves e ausência de overflow horizontal. Não cobre autenticação
real, rotas protegidas com sessão, dados reais ou jornadas completas de importação.
A suíte SQL usa shim de autenticação e dados sintéticos; não é o serviço Supabase
completo. O smoke foi contra o build local, não contra um deploy.

## Correções realizadas

1. Next.js e eslint-config-next: 16.2.12 -> 16.3.6. A versão antiga aparecia em
   alertas críticos de execução remota, incluindo hospedagem Windows. A versão
   corrigida foi consultada antes de iniciar o aplicativo.
2. Lockfile atualizado com correções compatíveis, incluindo sharp 0.35.4.
   Não foi usado audit fix --force. Auditoria completa caiu de 16 para 9 entradas;
   nenhuma crítica permaneceu. As contagens incluem dependentes afetados e não
   equivalem a 16 vulnerabilidades distintas nem a exploração comprovada.
3. Runner SQL: removida a exclusão inicial de container com nome fixo.
   Agora Docker cria um container exclusivo, sem rede/portas expostas, e o cleanup
   remove somente seu ID. A suíte real passou com esse comportamento.
4. ESLint: .consolidacao/** foi excluído do escopo. Essa pasta contém ferramentas,
   backups e logs locais; não é código do produto. O lint padrão foi reexecutado
   depois da alteração e passou sem erros.

Fontes de segurança consultadas:
- https://github.com/advisories/GHSA-p293-qw3h-jr36
- https://github.com/advisories/GHSA-2xp9-vwfh-vxw4
- https://github.com/advisories/GHSA-rgj7-g3m4-5g8c

## Ambiente e segurança da execução

Node 24.12.0 da máquina não satisfazia o requisito de jsdom 30.0.1. Foi usado Node
24.21.0 portátil em .consolidacao/runtime, obtido de nodejs.org e conferido contra
SHASUMS256.txt. npm 11.17.0 foi instalado somente em .consolidacao/tooling. Não foi
alterado Node/npm global nem o PATH persistente. O Chromium compatível já existia.

Os 990 resolved do lockfile original apontavam para registry.npmjs.org e possuíam
integrity. Essa verificação não equivale a revisão de todo código transitivo.
A instalação desativou lifecycle scripts. Build e testes depois executaram as
ferramentas locais necessárias. Não houve instalação de harness/framework agente.
Variáveis de teste apontavam para loopback e usavam valor fictício de chave;
nenhuma credencial real foi necessária. O container SQL foi removido pelo runner,
e os servidores de navegador/smoke foram encerrados ao final.

## Tentativas malsucedidas, preservadas nos logs

- A primeira suíte de componentes não iniciou workers em 60s: zero testes
  executados. Uma repetição da configuração original passou (93), e a execução
  diagnóstica direta com --pool=forks --maxWorkers=1 também passou (93). Não há
  causa raiz confirmada; não foi aumentada a tolerância nem habilitado retry.
- O primeiro gate foi interrompido no lint por demora; sua saída permanece
  vermelha no log. As etapas foram concluídas individualmente; não declaramos
  uma execução integral verde de npm run gate.
- A primeira tentativa de smoke atingiu o servidor do Playwright depois de ele
  ter encerrado. A execução final iniciou servidor próprio, aguardou prontidão
  e passou. A falha inicial não é evidência de defeito no PWA.
- Uma tentativa de passar opções pelo npm/PowerShell não as encaminhou ao Vitest.
  A comparação diagnóstica usou diretamente node node_modules/vitest/vitest.mjs.

## Pendências reais

O npm audit ainda aponta a cadeia de desenvolvimento de @lhci/cli: extract-zip e
versões antigas de tmp, com dependentes afetados. A sugestão automática inclui
um downgrade amplo de @lhci/cli; não foi aplicada. Lighthouse não foi executado
nesta rodada. Decidir sua atualização/substituição separadamente, com validação
específica, sem enfraquecer checks apenas para obter zero alertas.

Os dez avisos de lint não foram ocultados. Build informa depreciação do Edge
Runtime. A configuração .codex/hooks.json herdada ainda aponta para o caminho
histórico do projeto, conforme relatório de consolidação. Não foi ativada ou
corrigida nesta etapa. Nada disso permite afirmar auditoria integral de segurança.

## Evidências, reprodução e reversão

Logs em .consolidacao/: npm-audit-before.json, npm-audit-after.json,
audit-production.json, install.log, gate.log, unit.log, components.log,
components-forks.log, components-single.log, lint-final.log, build.log, sql.log,
e2e.log e smoke-final.log. Resumo em validation-summary.json.

Com Node compatível e npm 11.17.0, usar os scripts existentes. Para componentes
com um processo: node node_modules/vitest/vitest.mjs run --pool=forks --maxWorkers=1.
No Windows desta rodada, SQL foi chamado pelo bash do Git for Windows.
Playwright usou --workers=2 --retries=0 e porta local exclusiva; smoke usou servidor
próprio vinculado a 127.0.0.1. Nenhum teste necessita credenciais de produção.

As alterações desta rodada são versionadas separadamente. Para reversão, fazer
revert do commit específico após preservar trabalho posterior; não usar reset ou
clean. Reverter dependências restaura versões com alertas conhecidos, portanto
não iniciar esse estado antigo como servidor exposto.

Para avaliar a configuração Codex, esta rodada produz um caso real: falhas
identificadas, correções pequenas e aceitação verificável. Ela não é comparação
controlada com outro harness e não demonstra economia de tokens ou franquia.
