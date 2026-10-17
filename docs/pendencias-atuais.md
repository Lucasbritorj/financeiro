# Pendências atuais — 17/10/2026

Fonte de escopo desta rodada: `docs/specs/fechar-jornadas-financeiras.md`. O antigo `modelo_final_financeiro.md` é histórico de ideias; não é instrução técnica atual.

## Integração mais recente

- Correção da fatura Itaú instalada e publicada em 17/10: PR #14, versão `37993b3`, migração `20261017150000_corrigir_fatura_itau.sql`. Colunas, futuras, IOF, datas, sugestões e total revisados; painel/Análise por competência. Documento real conferido somente em ambiente privado; dados existentes preservados. Recuperação da importação antiga permanece pendente. Provas: `docs/correcao-fatura-itau.md`.

- Importação de faturas de cartão publicada inicialmente em 17/10 pelo PR #13 (`7666835`), com a migração `20261017130000_importar_faturas_cartao.sql`. Versão posteriormente substituída pela correção acima; provas e limites: `docs/importacao-faturas.md`.

- Central de Assinaturas de 07/10 e complementos de 11/10 integrados localmente, com contratos no cartão, status, periodicidades, custos e impacto por cartão. Critérios e provas: `docs/specs/integrar-central-assinaturas.md` e `docs/integracao-assinaturas.md`.
- Corrigidos paginação, próximas cobranças, recuperação de erros e concorrência com exclusão de cartão. Auditoria de dependências incorporada ao CI e ao gate local.
- Testes locais aprovados: 559 unitários, 147 componentes, 12 arquivos SQL, upgrade na ordem real, concorrência e 24 jornadas de navegador (22 anteriores + 2 novas). Lighthouse local: desempenho 77/acessibilidade 100.
- **Banco e interface publicados em 17/10:** três migrações aplicadas após autorização, com permissões e preservação dos dados conferidas; simulação final sem pendências. PR #12 integrado à master e versão `dc4d686` publicada na Vercel. Seis verificações HTTP de produção aprovadas.

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

## Situação da publicação

- Publicação e migração executadas em 16/10/2026 após autorização; detalhes e provas em `docs/publicacao-jornadas.md`.
- URL de recuperação confirmada pelo Lucas. Ainda falta conferir envio real, SMTP, template e políticas de confirmação/senha em conta de teste autorizada.
- Consulta remota de backups retornou lista vazia e PITR desativado. Definição anterior da função substituída preservada em `C:\Backup`; definir uma política de backup integral continua pendente.
- [PR #12](https://github.com/Lucasbritorj/financeiro/pull/12) integrado à master após aprovação dos seis checks. Publicação de produção confirmada como READY no domínio principal, com a Central de Assinaturas.

## Melhorias futuras, sem implementação nesta rodada

- Assistente conversacional: preparação de contexto existente, sem interface/integração.
- Onboarding completo: existe convite para categorias, falta orientação da primeira configuração.
- Agendamento de recorrências sem abrir o dashboard: o funcionamento atual é intencional e recupera ocorrências atrasadas ao abrir a tela.
- Contas bancárias, transferências e conciliação de saldo.
- Alertas, orçamento histórico por mês e exportação PDF.
- Mapeamento manual de colunas na importação e eventual Open Finance.
- Automatizar as jornadas autenticadas em um job próprio de CI com Supabase local.
- Reavaliar a cadeia de desenvolvimento do Lighthouse e os avisos de complexidade. Relatórios antigos de vulnerabilidades não representam uma auditoria atual.
