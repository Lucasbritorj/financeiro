# Pendências atuais — 16/10/2026

Fonte de escopo desta rodada: `docs/specs/fechar-jornadas-financeiras.md`. O antigo `modelo_final_financeiro.md` é histórico de ideias; não é instrução técnica atual.

## Entregas desta rodada (validação detalhada em .work/LOG.md)

- Consumo e análise excluem quitações de fatura, incluindo detectores de recorrência e tendência.
- Relatórios leem páginas completas; falhas não viram totais parciais.
- Histórico detalhado de faturas com navegação para páginas anteriores.
- Recuperação de senha por e-mail com confirmação da nova senha.
- CSV autenticado, com filtros e proteção contra fórmulas de planilha.
- Edição de cartões, categorias, cofrinhos e recorrências preservando saldos e histórico.
- Jornadas de navegador com autenticação/API/Postgres locais e contas temporárias.
- Correção da lista que não mostrava uma transação recém-criada após atualização do servidor.
- Correção dos três alertas de produção encontrados nesta rodada; auditoria final com zero entradas. A cadeia de desenvolvimento é uma verificação separada.

## Antes de publicar

- Aplicar a nova migração somente após conferir o banco alvo e o histórico de aplicação.
- Configurar a URL de recuperação e conferir SMTP, confirmação de e-mail e backups: `docs/verificacao-instalacao.md`.
- Conferir a publicação e a configuração efetiva no ambiente real. Não foram acessadas nesta rodada.

## Melhorias futuras, sem implementação nesta rodada

- Assistente conversacional: preparação de contexto existente, sem interface/integração.
- Onboarding completo: existe convite para categorias, falta orientação da primeira configuração.
- Agendamento de recorrências sem abrir o dashboard: o funcionamento atual é intencional e recupera ocorrências atrasadas ao abrir a tela.
- Contas bancárias, transferências e conciliação de saldo.
- Alertas, orçamento histórico por mês e exportação PDF.
- Mapeamento manual de colunas na importação e eventual Open Finance.
- Automatizar as jornadas autenticadas em um job próprio de CI com Supabase local.
- Reavaliar a cadeia de desenvolvimento do Lighthouse e os avisos de complexidade. Relatórios antigos de vulnerabilidades não representam uma auditoria atual.
