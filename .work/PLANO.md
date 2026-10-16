# Plano — Fechar jornadas financeiras
Autorização: Lucas pediu «execute a sua recomendação». Execução sequencial nesta raiz.

## Fase 1 — Relatórios e histórico (CA1–CA3)
Criar regressão da página Análise, leitura paginada compartilhada e navegação das faturas. Preservar natureza e falhar integralmente em erro. Arquivos: páginas Análise/Dashboard/faturas, helper de leitura e testes. Prova: unitários dirigidos e testes de páginas com cliente simulado; depois suíte completa.

## Fase 2 — Recuperação (CA4)
Adicionar pedido no login, callback PKCE e formulário de nova senha; permitir só as rotas públicas necessárias no proxy. Ler docs locais Next e contrato instalado Supabase. Prova: componentes e handlers, navegador público e erros de código/sessão.

## Fase 3 — CSV (CA5)
Serializador seguro e rota autenticada, botão com filtros na página transações. Reutilizar leitura paginada. Prova: unitários de valores/escape/fórmulas e testes da rota com usuário ausente, dados e erros.

## Fase 4 — Edições (CA6)
Migration aditiva com RPCs para cartão/cofrinho/recorrência; reutilizar editar_categoria. Não alterar saldos/passado. Formulários de edição nas telas existentes, tipos atualizados. Prova: asserts SQL escritos antes da migration e testes de componente dos formulários.

## Fase 5 — Jornadas e instalação (CA7–CA8)
Executar Postgres 17 efêmero sem banco remoto e ampliar jornadas conforme serviços locais disponíveis. Documentar limites com transparência; criar procedimento de conferência somente de leitura, atualizar lista de pendências e README de migrações. Prova: suíte SQL completa e navegador com sessões locais quando disponíveis.

## Fase 6 — Entrega
Rodar npm test, npm run test:componentes, npm run lint, build, navegador e smoke pertinentes. Corrigir os alertas altos de dependências existentes encontrados na auditoria (CA9), sem atualização major. Revisar diff, registrar prova no LOG, marcar checklist somente pelo demonstrado. Não repetir suítes válidas sem mudanças pertinentes.

## Fase 7 — Publicação autorizada em 16/10/2026

Preservar definição anterior da função, aplicar apenas migração pendente, conferir permissões por leitura, criar produção sem domínio, validar rotas e promover a mesma versão. URL de recuperação confirmada pelo Lucas. Estado e limites em docs/publicacao-jornadas.md; testes com escrita permanecem locais.
