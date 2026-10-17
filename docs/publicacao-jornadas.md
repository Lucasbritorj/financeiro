# Publicação das jornadas financeiras — 16/10/2026

## Versão para conferência

- Prévia: https://financeiro-rfmtefa13-brito-s.vercel.app
- Projeto Vercel: `brito-s/financeiro` (`prj_NXCSrkSUpNGdrVLg5Ke8CfnGK2RG`).
- Produção: https://financeiro-brito-s.vercel.app
- Supabase: `bqkichuwmugkjumpvrio`, região `sa-east-1`.
- Branch local: `codex/fechar-jornadas-financeiras`, integrada com `origin/master` em `2513c5e`.
- Prévia protegida pelo login da Vercel. Configurações públicas do Supabase fornecidas em memória pela CLI autenticada; nenhum arquivo de ambiente alterado.

## Provas

- Gate após integração e correção: 548 unitários e 133 testes de componentes; tipos, lint e build aprovados. Lint mantém 12 avisos existentes.
- Build remoto da prévia: `READY`, Next.js 16.3.8.
- Navegador: login → recuperar senha, projeto Supabase esperado no aplicativo, zero erros de execução. Recursos obtidos pela CLI autenticada preservando a proteção da prévia; nenhuma conta criada, e-mail enviado ou dado financeiro alterado.
- Captura local: `.work/preview-recuperacao.png`.
- Auditoria de dependências de produção: zero vulnerabilidades.
- Pacote de upload conferido: zero arquivos de `.work`, `.maestri`, `.claude`, `memory`, `.env*` ou `supabase/.temp`.

## Procedimento de publicação

1. Aprovação explícita do Lucas para publicação e para a migração `20261016200000_editar_cadastros.sql`.
2. Preservar a definição atual de `editar_categoria` antes da aplicação. A API de backups retornou lista vazia em 16/10/2026 e PITR desativado; não há restauração física confirmada. Qualquer exportação de segurança deve ficar em `C:\Backup`, sem dados pessoais no repositório.
3. Conferir a configuração Auth pelo painel: https://supabase.com/dashboard/project/bqkichuwmugkjumpvrio/auth/url-configuration . Manter as URLs existentes e acrescentar `https://financeiro-brito-s.vercel.app/login/confirmar` se ausente. Site URL deve apontar para a origem de produção. Conferir template padrão, SMTP e senha mínima 8. Essas configurações ainda não foram verificadas remotamente. Não aplicar `supabase config push` com a configuração local, pois substituiria configurações remotas.
4. Após aprovação, aplicar somente a migração pendente ao projeto vinculado, com `--skip-vault`. A simulação `supabase db push --linked --dry-run --skip-vault` confirmou somente esse arquivo; nenhuma migração foi aplicada nesta preparação.
5. Conferir histórico e assinaturas/permissões das quatro funções por consultas somente de leitura. Não executar testes SQL contra produção.
6. Publicar com configurações de produção do projeto existente. Não promover diretamente a prévia: fazer deploy com destino de produção, preservando a separação dos ambientes.
7. Conferir rotas públicas e proteção das rotas autenticadas. Validar recuperação real somente com conta de teste autorizada; não alterar registros financeiros reais para testar.

## Retorno

Versão anterior confirmada como publicada: https://financeiro-p98miqs2p-brito-s.vercel.app (`2513c5e`). Se a publicação falhar, promover essa versão anterior na Vercel. As funções novas podem permanecer sem uso; não apagar dados nem desfazer histórico de migrações automaticamente. Reverter `editar_categoria` somente com a definição preservada e revisão específica.

## Resultado da execução autorizada

Lucas autorizou seguir com a publicação e migração em 16/10/2026. Também confirmou que a URL de recuperação já estava cadastrada; não foi necessário alterar Auth.

- Definição e permissões anteriores de `editar_categoria` preservadas em `C:\Backup\financeiro-web\2026-10-16\editar_categoria-antes.json`. Isso é cópia da definição da função, não backup integral do banco.
- Migração `20261016200000_editar_cadastros.sql` aplicada com sucesso, sem seeds, roles ou atualização de Vault.
- Consulta posterior confirmou a migração e quatro funções: `security_definer=true`, `search_path` vazio, execução permitida a `authenticated` e negada a `anon`.
- Deploy de produção `dpl_2NkVwHqrcoq1Hhv9Sqc6t1Sp54MY` criado sem domínio, testado e promovido. Versão imutável: https://financeiro-bdjzloygq-brito-s.vercel.app . Alias confirmado: https://financeiro-brito-s.vercel.app . Código em `176750f`.
- Cinco verificações HTTP aprovadas antes e depois da promoção: login200, recuperação200, dashboard307 para login, exportação307 para login e callback sem código303 para solicitar novo link. Acesso pela CLI autenticada; proteção Vercel mantida.
- Segurança: gitleaks percorreu 172 commits sem vazamentos; dependências de produção com zero vulnerabilidades.

O envio e recebimento de e-mail real, SMTP, template e políticas de confirmação/senha não foram verificados remotamente. A URL de recuperação foi confirmada pelo Lucas. As jornadas completas com gravação foram verificadas no ambiente local; nenhum registro financeiro real foi alterado para teste. A proteção da Vercel exige acesso autorizado também no domínio de produção.

Nenhum push Git foi realizado; os commits da implementação estão na branch local. O deploy foi feito diretamente pela CLI.
