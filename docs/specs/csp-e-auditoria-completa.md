# Política de scripts e auditoria completa
**Pronto significa:** CA1–CA5 comprovados em testes, build e navegador; auditoria completa somente declarada após relatório final do Codex Security.
Status: execução autorizada em 17/10/2026.
## Objetivo
Remover permissões amplas de scripts em produção, preservar autenticação/tema/importação e auditar o projeto inteiro após a correção.
## Histórias
- Como titular, quero bloquear scripts sem autorização e continuar usando o aplicativo.
- Como mantenedor, quero testes e relatório com limitações explícitas.
## Critérios de aceite
- **CA1** — Dada resposta HTML de produção, quando carregada, então script-src não contém unsafe-inline/unsafe-eval; scripts do Next e tema recebem nonce aleatório por requisição.
- **CA2** — Dado nonce/CSP enviado pelo cliente, quando passa pelo proxy, então é substituído; atualização de cookies e redirects mantêm CSP/cookies.
- **CA3** — Dada navegação local de produção, quando usada, então tema/login/recuperação e jornadas autenticadas funcionam; script inline sem nonce e eval são bloqueados no navegador.
- **CA4** — Dada resposta com nonce ou no-store, quando o service worker decide guardar, então recusa e limpa caches antigos na atualização; arquivos estáticos continuam disponíveis.
- **CA5** — Dadas funções bancárias atuais, quando testadas em Postgres descartável, então isolamento e concorrência são comprovados ou falhas relatadas sem instalar no remoto.
- **CA6** — Dado projeto após correção, quando auditado, então entregar relatório completo ou bloqueio exato, sem afirmar ausência de vulnerabilidades com cobertura incompleta.
## Casos de borda
Cookies renovados; redirects; desenvolvimento com eval; HTTP/WebSocket local; PDF worker; cabeçalhos forjados; cache antigo; banco indisponível.
## Fora do escopo
Publicação, migrações remotas, mudanças de senha e completar as funcionalidades ainda em construção.
## Perguntas abertas
Nenhuma. A regra de organização bloqueou criação em 50bc; implementar e auditar na pasta central autorizada, sem copiar o projeto.
## Premissas e garantias
1. Nenhuma gravação em produção; preservar cookies na mesma resposta.
2. Sem repetição de chamadas externas de escrita; usuários fictícios locais.
3. Nonces independentes; concorrência SQL em container exclusivo sem rede.
4. Autenticação mantém timeout já existente.
5. Nenhuma consulta financeira extra pelo CSP.
6. Substituir nonce do cliente e validar origem Supabase.
7. Trade-off: HTML dinâmico sem cache permite autorização por requisição; estilos inline mantidos para compatibilidade com o design.
