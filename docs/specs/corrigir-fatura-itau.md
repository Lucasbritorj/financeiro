# Spec — Correção da leitura e conferência de faturas Itaú
**Pronto significa:** CA1–CA12 passam em testes de domínio, componentes, SQL local e jornada autenticada; lint/build e revisão independente aprovados, sem dados reais no Git.
Status: execução autorizada pelo Lucas em 17/10/2026 após auditoria do PDF original.

## Objetivo
Corrigir as causas da importação incorreta: contexto de extrato, colunas misturadas, pagamentos, futuras, encargos, datas e sugestões. Mostrar consumo do cartão por competência de cobrança, sem alterar o lote real já gravado.

## Histórias
- Como usuário, quero revisar uma fatura com valores iguais aos do documento antes de confirmar.
- Como usuário, quero separar compras, parcelas futuras, pagamentos e possíveis assinaturas.
- Como usuário, quero ver despesas do cartão no mês da fatura e previsões separadas.

## Critérios de aceite
- **CA1** — Dado o importador inicial, quando abrir, então exige escolha explícita de extrato/fatura; PDF identificado como fatura no extrato é recusado antes de criar staging.
- **CA2** — Dadas duas tabelas lado a lado com datas/cabeçalhos, quando extraídas, então preserva a ordem em cada coluna sem misturar pagamentos, compras e valores em moedas diferentes; exemplo público usa somente conteúdo fictício.
- **CA3** — Dadas seções de pagamentos, compras atuais, próximas faturas e ofertas, quando lidas, então somente cobranças atuais entram no total; futuras permanecem informativas e não podem ser confirmadas como compras.
- **CA4** — Dada compra internacional com moeda original/conversão e IOF sem data, quando lida, então preserva o valor cobrado em reais e registra o IOF separado com data de referência explícita e revisável; total fecha em centavos.
- **CA5** — Dada parcela futura explícita e univocamente correspondente, quando revisar/confirmar, então seu valor alimenta somente a previsão do plano; arredondamento não altera a cobrança atual nem cria despesa futura. Correspondência ambígua não é automática.
- **CA6** — Dadas datas sem ano, quando inferidas pela competência e parcela, então ano não depende do relógio e a revisão exige confirmar datas sugeridas; mês da fatura incompatível com vencimento do PDF é recusado.
- **CA7** — Dados descritores de clube, software, Apple concatenado com cidade e serviço internacional, quando analisados, então sugere assinatura com decisão obrigatória; marketplace parcelado continua parcela, e serviços iguais não são unidos silenciosamente.
- **CA8** — Dado PDF com total divergente ou descartes, quando confirmar, então bloqueia divergência do total extraído imutável e exige conferência dos descartes; revisão exibe total, previsões, origem e orientação de categorias. Datas não confirmadas bloqueiam cliente e servidor.
- **CA9** — Dados recebimento repetido, vínculo de plano e valor futuro inválido, quando confirmar, então retry permanece idempotente, usuário distinto é isolado e lote inválido é desfeito integralmente; migração é aditiva.
- **CA10** — Dados débitos/receitas e parcelas de cartão, quando consultar painel/Análise, então usa data dos movimentos à vista e competência/valor da cobrança do cartão, sem somar a transação original de novo nem incluir estimativas.
- **CA11** — Dado mês com movimentos sem alerta detectado, quando analisar, então não afirma equilíbrio ou estabilidade histórica sem evidência; navegação permite escolher mês anterior.
- **CA12** — Dado fluxo local autenticado com PDF fictício de duas colunas, quando revisar/confirmar/recarregar, então total, parcelas e contrato persistem; extrato continua funcionando; interface preserva padrões existentes, teclado, celular e acessibilidade.

## Casos de borda
- Layout desconhecido, PDF sem texto, múltiplas datas/valores, cartões diferentes, seção futura sem atual correspondente e duas compras semelhantes.
- Parcela final no mesmo mês do vencimento mas de ano anterior; parcela inválida; datas completas preservadas; dados vazios e falha de rede.
- IOF zero/resumos repetidos; crédito bloqueado; valor futuro inválido; fatura fechada; retry e confirmação concorrente continuam protegidos.

## Fora do escopo
- Excluir/reclassificar o lote de produção, publicar ou instalar migrações remotas nesta etapa; OCR, IA externa, garantia de todos os layouts, contratar serviços ou executar pagamentos.
- Materializar previsões como despesas; reconstruir parcelas antigas; tratar estornos como compras.

## Perguntas e premissas
- Sem pergunta pendente: autorização para corrigir os problemas auditados; preservar dados atuais e manter etapas remotas separadas.
- PDF original e extrações permanecem privados; regressões públicas reproduzem apenas estrutura com nomes/valores fictícios.
- Valores futuros explícitos alimentam a estimativa editável do plano, sem garantir cada mês não detalhado no PDF.

## Premissas e garantias
- Atomicidade: manter confirmação em uma transação no banco, incluindo plano e contrato; nenhum serviço externo novo.
- Repetição: preservar chave/hash e restrições atuais; nenhuma gravação durante leitura.
- Concorrência: manter trava por usuário e validações finais dos vínculos.
- Rede: manter timeout e erro explícito; sem retry novo de escrita.
- Consultas: leitura paginada, view com isolamento do chamador, sem consulta por linha.
- Validação: moeda em centavos e validação de campos novos no cliente/servidor.
- Trade-off: layout por cabeçalhos e revisão explícita favorecem integridade e privacidade; formatos ambíguos podem exigir correção manual.
