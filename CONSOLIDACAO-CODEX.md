# Financeiro consolidado para Codex — 25/09/2026

## Local e resultado

Pasta: `C:\Users\Lucas\.codex\projects\financeiro-codex`.
Branch: `codex/consolidacao-financeiro`.
Principal remoto: https://github.com/Lucasbritorj/financeiro .
Legado remoto: https://github.com/Lucasbritorj/financeiro-web .

A consolidação é local. Não houve push nem alteração de configurações GitHub.
O projeto mantém sua identidade; codex identifica somente esta cópia de trabalho.

## Escolha baseada no histórico

O master de financeiro tinha 93 commits exclusivos em relação ao master do legado;
o legado tinha somente um merge exclusivo. Os commits de desenvolvimento de suas
duas branches já pertenciam ao histórico principal. A integração desse merge não
alterou nenhum arquivo.

Dentro de financeiro, codex/evolucao-financeiro estava seis commits à frente de
master, sem divergência. Essa foi a base escolhida, preservando melhorias já
existentes de importação, fechamento mensal, navegação móvel e verificações.
Base selecionada: `193ffbd2520a71bd7550ee3bd0f8164ebbcc9b68`.
Merge de histórico legado: `1641779d145c03d96c939b9af9a108ce87844cba`.

A análise de todas as branches encontrou dez branches com commits de patches
equivalentes já incorporados. A branch wt/migracoes-gate tinha quatro commits
adicionais, com cinco arquivos de verificações estáticas de migrações. O código
desses arquivos foi lido integralmente antes da execução; usa módulos nativos do
Node e leitura local de SQL. Foi integrado sem conflito, no commit `fa325a10ed544fbba0cc4e6781c48ea11fa06d0a`.

Após a consolidação, git cherry não encontrou patches exclusivos não representados
em nenhuma branch remota coletada. Isso é evidência de equivalência de patches,
não alegação de que todos os SHAs históricos sejam ancestrais. Todas as referências
foram preservadas na mesma pasta Git e no backup.

## Verificações e limites

- 36 testes dos quatro arquivos migracoes-*.test.ts: passaram; zero falhas.
- O merge legado tem árvore idêntica à base selecionada.
- O merge adicional acrescentou somente os cinco arquivos de testes/helper.
- .claude e CLAUDE.md não diferem do master original.
- Nenhuma dependência foi instalada; aplicativo e banco de dados não foram iniciados.
- A suíte completa, build, interface e execução SQL não foram validados nesta etapa.
- O Node emitiu aviso MODULE_TYPELESS_PACKAGE_JSON; não foi necessário mudar a
  configuração de módulos para executar os testes.

Os testes verificam texto SQL e casos sintéticos; não substituem validação em
PostgreSQL ou auditoria integral de segurança. Nenhuma credencial de produção foi
necessária. As cópias originais do usuário não foram modificadas.

## Repositório antigo

financeiro-web já estava arquivado. O PR
https://github.com/Lucasbritorj/financeiro-web/pull/2 continua aberto; seu head já
pertence ao histórico principal. Manter o arquivo histórico evita apagar metadados
de revisão sem benefício para o projeto. Por isso não houve exclusão remota.
A razão original da criação de dois repositórios não foi determinada.

## Backup e reversão

`.consolidacao/before-consolidation.bundle` preserva as referências Git coletadas
antes das alterações. Sua validade foi conferida com git bundle verify.
`.consolidacao/refs-before.txt` lista as referências e
`.consolidacao/verification.json` registra commits, cobertura de branches e testes.
A pasta é ignorada localmente. Bundle não inclui issues/PRs, configuração GitHub,
banco de dados nem alterações locais nunca enviadas ao GitHub.

master local permanece no master original. Para voltar, preservar qualquer trabalho
posterior e trocar para master, sem reset/clean. Outra opção é clonar o bundle numa
pasta nova. Os commits criados usam identidade explícita Codex <codex@local.invalid>
por comando; nenhuma identidade Git global foi configurada.

## Próximo passo e achado de configuração

Auditar scripts/dependências e escolher uma melhoria real antes de instalar ou
executar o aplicativo. A branch de evolução já traz .codex/hooks.json referenciando
o caminho antigo C:\Users\Lucas\Workspace\financeiro-evolucao. Esse hook foi lido,
mas não foi executado nem instalado globalmente. Sua configuração não deve ser
considerada funcional nesta nova pasta sem revisão específica. Os arquivos Claude
continuam preservados e fora do escopo de personalização.
