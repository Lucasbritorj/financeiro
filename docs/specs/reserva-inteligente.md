# Reserva sugerida por cofrinho
Pronto significa: CA1–CA8 comprovados por testes de domínio, SQL, componentes e jornada local; build/lint/segurança e revisão registrados. Publicação não faz parte deste pedido.

## Objetivo
Estimar uma reserva mensal e distribuí-la entre cofrinhos, com explicação, cobertura do histórico e confirmação humana. Aproveitar contas, conciliação, competência e metas existentes.

## Histórias
- Como titular, quero definir intenção mensal, margem e prioridades sem criar despesas.
- Como titular, quero distinguir ausência de dados de ausência de sobra.
- Como titular, quero simular agora e usar histórico conferido quando disponível.

## Critérios de aceite
- CA1: Dadas preferências válidas, ao salvar, persistem por titular; terceiros/anon não leem nem alteram; repetir substitui somente preferências, sem aporte.
- CA2: Dados três meses anteriores completos, cada mês mostra cobertura das contas cadastradas (início anterior ao mês e fechamento até fim) e faturas importadas ativas de todos os cartões cadastrados. Sem fontes ou com pendências não há sugestão baseada no histórico. Cobertura é requisito mínimo, não garantia de completude nem descoberta de contas não cadastradas.
- CA3: Dado histórico, ao calcular renda/despesa, considerar somente CONSUMO; transferências e liquidação de fatura não somam novamente. Renda-base é a menor receita mensal e gasto-base o maior gasto mensal dos três meses, nunca uma inferência de salário.
- CA4: Dadas intenção, margem, caixa livre informado (exclui cofrinhos) e compromissos ainda a pagar informados, reserva fica entre zero e o menor de intenção, capacidade mensal e caixa livre após compromissos/margem. Aportes líquidos do mês reduzem intenção/capacidade restantes. Planejamento atual de cartões/assinaturas é piso de despesa mensal, sem somar duas vezes ao histórico. Caixa desconhecido não gera sugestão.
- CA5: Dados cofrinhos ativos, distribuir por prioridade (alta, média, baixa), prazo e id; cobrir contribuição mensal necessária primeiro e depois saldo faltante. Soma exata em centavos <= reserva, nenhum alvo ultrapassado. Metas concluídas não recebem. Prazo vencido pede saldo faltante imediato.
- CA6: Dados dados incompletos ou renda/gasto declarados, resultado é explicitamente simulação; três meses completos e sem substituições permitem estimativa histórica, sempre com limitações visíveis. Nenhum aporte automático e nenhum envio de dados a IA externa.
- CA7: Dado formulário alterado, simular explica bases, limites, déficit da intenção e valor por meta; salvar não confirma reserva, falha de rede é visível. Aportes permanecem no controle já existente.
- CA8: Dada consulta falha/limite excedido/migração ausente, não inventar zeros nem oferecer estimativa; mostrar indisponibilidade e preservar cofrinhos existentes. Página utilizável no celular e por teclado.

## Casos de borda
Zero, negativos, overflow, meses sem atividade, fonte ausente, transferência, pagamento de cartão, caixa insuficiente, metas sem prazo/vencidas/concluídas, orçamento menor que necessidades e falha de persistência.

## Fora do escopo
Publicar/aplicar migração remota; movimentar banco/aportar automaticamente; recomendar investimentos; detectar salário ou classificar exceções automaticamente; aceitar histórico não conferido como confiável.

## Perguntas abertas e premissas
Sem bloqueio: simulação conservadora, sem rendimentos. Intenção e caixa são informados pelo titular. Histórico usa três meses fechados anteriores ao atual; fontes cadastradas devem incluir todas as contas/cartões relevantes. Prioridade padrão média; prazo antes de id no desempate. Caixa e compromissos devem ser atualizados pelo titular; preferências não são saldo bancário ao vivo.

## Premissas e garantias
1. Consistência: somente uma escrita de preferências, nenhum efeito externo.
2. Repetição: upsert único por titular, nunca cria aportes.
3. Concorrência: preferências completas substituídas atomicamente; última gravação vence, explicado na tela.
4. Falha: consultas limitadas/com timeout, erro visível sem estimativa falsa.
5. Consultas: paginação por id e janela de três meses, sem N+1.
6. Validação: centavos inteiros limitados, prioridades somente de cofrinhos próprios, RLS e RPC autenticada.
Trade-off: regras explicáveis e entradas manuais de caixa permitem começar sem conexão bancária; automação da previsão de caixa fica para etapa posterior.

## Fases
1. Testes vermelhos e motor financeiro puro.
2. Preferências privadas, cobertura/consulta e SQL descartável.
3. Interface em Cofrinhos, regressões, segurança e revisão.
