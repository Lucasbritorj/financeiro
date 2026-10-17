# Plano — Corrigir fatura Itaú
Spec: docs/specs/corrigir-fatura-itau.md. Execução autorizada em 17/10/2026; trabalho sequencial nesta raiz.

## Fase A — Regressões (CA1–CA11)
Criar exemplos fictícios de duas colunas, seções e câmbio; testes de extração/classificação/previsão, bloqueios do hook, competência e SQL local. Demonstrar falhas antes do código. Não usar PDF real como fixture pública.

## Fase B — Leitura e revisão (CA1–CA8)
Corrigir leitura-arquivo/importacao-fatura e componentes existentes: contexto explícito, colunas por cabeçalhos, futuras separadas, IOF e datas revisáveis, sugestões e totais. Provar unitários e componentes dirigidos. Usar sistema visual existente.

## Fase C — Integridade e competência (CA5, CA8–CA11)
Migration aditiva para validar/persistir valor previsto e confirmação de datas; view de movimentos por competência com RLS do chamador. Painel/Análise usam view paginada; fallback honesto. Provar SQL efêmero local, upgrade e suites dependentes.

## Fase D — Jornada e entrega (CA12)
Jornada real com Supabase local e PDF fictício de duas colunas; screenshots/acessibilidade. Testes, lint, build, segurança, revisão independente só leitura, LOG e commits locais. Sem instalação/publicação remota nem alteração do lote real.

---

# Histórico — Importar faturas de cartão
Rodada aprovada em 17/10/2026: `docs/specs/importar-faturas-cartao.md`. Lucas autorizou executar o planejamento. Desenvolvimento/testes locais; instalação e publicação remotas permanecem em etapa operacional separada. Histórico anterior preservado abaixo.

## Fase 1 — Exemplos, contratos e testes antes do código (CA1–CA10)
Obter exemplo Itaú PDF privado autorizado ou fictício; definir interpretação de data/valor/parcela, modelo de plano versus cobrança efetiva, vínculos entre meses, casos ambíguos e créditos. Exemplos públicos somente fictícios. Escrever regressões em tests/unit e asserts em tests/sql e comprovar vermelho pelo comportamento ausente. Arquivos centrais: src/lib/csv.ts, pdf-extrato.ts, importacao-preview.ts, leitura-arquivo.ts, tipos e RPCs atuais de importação. Ler a documentação Next instalada antes de código que a envolva. Prova: node --test tests/unit/<arquivo>.test.ts; SQL em Postgres local confirmado. Não modificar migrações publicadas.

## Fase 2 — Leitura e reconhecimento compartilhados (CA1–CA3, CA7–CA8)
Preservar o fluxo de extrato e acrescentar contexto de fatura; adaptadores dos cinco formatos alimentam contrato único, preservando origem/evidência e indicando suporte por layout. Reconhecer parcelas e possíveis assinaturas com regras revisáveis; normalizar sinal e mês por contexto. PDF sem texto informa ausência de suporte, não inventa linhas. Verificar testes dirigidos de CSV/PDF/OFX e das regras novas; provar falso positivo de data versus parcela e virada de ano.

## Fase 3 — Persistência e conciliação (CA4–CA6, CA9–CA11)
Migration aditiva e RPCs específicas de fatura sem mudar silenciosamente confirmar_importacao do extrato. Usar plano/metadata para previsões separadas e cobrança efetiva na fatura selecionada; evitar alterar dinheiro efetivo com projeções. Validar isolamento, unicidade, travas, resposta perdida, importação posterior e associação explícita de ambiguidades. Contratos de assinatura não geram outra despesa. Arquivos: nova migração, src/lib/database.types.ts, consultas afetadas e tests/sql. Prova: npm run test:sql com alvo local confirmado; upgrade real e concorrência conforme impacto; testes de dinheiro e persistência dependentes.

## Fase 4 — Revisão na interface (CA2–CA8, CA12)
Alterar src/app/(protegido)/importar/page.tsx e src/components/importador-csv/: escolher extrato/fatura, cartão e mês; cadastro quando ausente; linha original, sugestão/motivo, edição de parcelas e assinaturas, escolha de vínculo e pendências. Exibir valores reais e previstos separados. Aplicar design-system e padrões existentes. Prova: npm run test:componentes -- tests/componentes/<arquivo>, teclado, screenshots celular/desktop e testes de falha de rede/novo envio.

## Fase 5 — Jornada completa e regressões (CA1–CA12)
Supabase local e contas temporárias: Itaú PDF, conta sem cadastros, confirmação, reload, mês seguinte, reenvio, ambiguidades, falha e usuário distinto; extrato CSV continua válido. Fixtures e faturas reais não vão ao repositório público. Prova: navegador autenticado com API/Postgres reais locais, totais de faturas/relatórios, axe e screenshots; npm run lint/build e suítes dependentes. Registrar vermelho/verde e evidência por critério, sem repetir suítes válidas sem motivo.

## Fase 6 — Revisão e preparação da entrega
Skill seguranca, auditoria do diff e revisor independente somente leitura conforme skill revisar. Atualizar docs, limites por formato e procedimentos de migração/retorno; commits pequenos em branch codex/. Preparar PR/prévia. Instalação remota e publicação apenas na etapa autorizada correspondente, sem dados de teste em produção.

Execução sequencial: as fases compartilham contratos, tipos, RPCs e componentes. Sem lote paralelo proposto.

---

# Histórico — Fechar jornadas financeiras
Rodada atual: **Integração da Central de Assinaturas**, spec `docs/specs/integrar-central-assinaturas.md`. Histórico das fases anteriores preservado abaixo.

## Integração — fase A: regressões e incorporação
Trazer testes de assinaturas antes do produto, demonstrar ausência da implementação, integrar os commits 8a9d5d1/d4c6285 sem perder as edições atuais. Incluir auditoria CI de forma mínima. Conferir ordem das migrações e resolver conflitos por contrato, sem selecionar uma versão inteira por conveniência.

## Integração — fase B: consistência e jornadas
Corrigir falhas comprovadas de datas, paginação/rede e integração SQL. Executar unitários/componentes dirigidos, Postgres efêmero local e jornadas autenticadas com Supabase local. Seguir design existente e conferir celular/desktop.

## Integração — fase C: entrega revisada
Executar gate, segurança e revisão independente somente leitura. Registrar prova por CA, atualizar pendências e fechar commits locais. Instalação remota é etapa separada; nenhum teste escreve no banco remoto.

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
