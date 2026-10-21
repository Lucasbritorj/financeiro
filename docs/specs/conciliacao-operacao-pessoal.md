# Conciliação e operação pessoal
**Pronto significa:** critérios abaixo passam nos testes locais reais; verificações externas têm prova própria e pendências explícitas.
Status: execução autorizada pelo pedido de 17/10/2026 · Nível: spec first.

## Objetivo
Concluir os cuidados operacionais e acrescentar orçamento por mês, contas, conciliação, OCR e integração pessoal Pluggy, nessa ordem de complexidade.

## Histórias
- Como titular, quero recuperar acesso, conferir dados antigos e restaurar backups.
- Como titular, quero limites por categoria e mês sem reescrever meses anteriores.
- Como titular, quero conferir meus saldos e vincular extratos ao que já registrei.
- Como titular, quero revisar PDFs digitalizados antes de importar.
- Como titular, quero ler minhas contas pelo Meu Pluggy sem expor credenciais.

## Critérios de aceite
- **CA1** — Dado o e-mail autorizado, quando solicitado reset, então registrar envio sem trocar senha nem consumir link; recebimento/troca dependem do titular.
- **CA2** — Dadas importações legadas, quando auditadas, então listar inconsistências em relatório privado, sem exclusão por heurística.
- **CA3** — Dado backup, quando restaurado em banco descartável, então conferir contagens e conteúdo; agendamento depende do destino confirmado e credencial já disponível.
- **CA4** — Dada categoria, quando salvo limite em um mês, então outros meses permanecem independentes; gasto usa competência e exclui quitação de fatura.
- **CA5** — Dado limite zero, ausente ou inválido, quando calculado, então distinguir zero/sem limite e recusar centavos inválidos.
- **CA6** — Dada conta e saldo em data inicial, quando criada, então movimentações anteriores são recusadas; acesso de outro usuário é bloqueado.
- **CA7** — Dada transferência própria, quando repetida com mesma chave, então criar um único par de movimentos opostos, sem gerar receita/despesa.
- **CA8** — Dado extrato associado à conta, quando reimportado, então preservar linhas bancárias separadas e não duplicar IDs externos; linhas indistinguíveis sem ID exigem revisão.
- **CA9** — Dada linha e lançamento compatível, quando conciliados, então vincular uma única vez, sem nova despesa; divergência de valor/sinal/data é recusada.
- **CA10** — Dada linha não registrada, quando confirmada como nova, então criar lançamento e vínculo atomicamente; pagamento de fatura exige vínculo próprio.
- **CA11** — Dado saldo informado e período, quando conferido, então mostrar diferença em centavos e pendências; fechamento só com saldo igual e nenhuma linha pendente.
- **CA12** — Dada conciliação, quando desfeita, então registrar histórico, impedir alterações silenciosas e respeitar períodos fechados.
- **CA13** — Dado PDF sem texto, quando OCR autorizado, então processar localmente com limite de páginas/tamanho, progresso e revisão obrigatória; erros não geram importação.
- **CA14** — Dada integração Pluggy, quando consultada, então usar credenciais somente no servidor, vincular conexão ao titular e limitar tempo/paginação; sem configuração, explicar indisponibilidade.
- **CA15** — Dada sincronização repetida, quando recebida, então atualizar staging bancário sem duplicar transações nem confirmar gastos automaticamente; teste real depende da conta Pluggy do titular.
- **CA16** — Dadas telas novas, quando usadas em celular/desktop e ambos os temas, então não haver overflow, com teclado, axe e erros explícitos; testes, build, lint e SQL local passam.

## Casos de borda
Saldo negativo; transferência no mesmo dia/entre mesma conta; compras iguais; reimportação parcial; lançamento editado/excluído; meses inválidos; saldo bancário defasado; timeout/429; PDF grande/protegido; OCR incorreto; ausência de migração.

## Fora do escopo
BPO para terceiros, iniciação de pagamentos, conexão de familiares no plano pessoal, alterações de senha pelo agente e eliminação automática de dados legados.

## Perguntas e dependências externas
- Conta principal autorizada para solicitar recuperação; somente o titular pode conferir caixa de entrada e escolher nova senha.
- Destino/agendamento de backup e uso exclusivamente pessoal do Pluggy: perguntas enviadas; não executar ações dependentes antes das respostas.
- Não há credencial Pluggy fornecida: implementar contrato e testes sem fabricar conexão real.

## Premissas e garantias
1. Escrita dupla: extrato/lançamento/vínculo na mesma transação; chamada Pluggy antes de gravar lote integral.
2. Idempotência: chaves únicas por titular/conta/evento, sem deduplicar compras distintas apenas pelo valor.
3. Concorrência: travas por conta e restrições únicas; transferência trava ambas em ordem estável.
4. Dependências: timeout limitado, erro visível, sem repetir escritas externas.
5. Consultas: índices por titular/conta/data; período e paginação limitados.
6. Validação: centavos inteiros, datas reais, lotes limitados e permissão em toda RPC.
7. Trade-off: conferir manualmente casos ambíguos preserva integridade ao custo de mais revisão.

## Interface
Reusar direção Ateliê, tokens quentes, tipografia e superfícies das páginas Categorias/Planejamento; listas com detalhe expandível, sem nova identidade visual.
