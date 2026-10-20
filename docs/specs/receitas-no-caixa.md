# Receitas no caixa
Pronto significa: CA1–CA7 passam em testes de componente/SQL e regressões do formulário; build/lint e revisão registrados. Implementação autorizada pelo comentário de uso em 20/10/2026; instalação/publicação remota é etapa posterior.

## Objetivo
Separar a entrada de receita do fluxo de compras, com tipo primeiro, recebimento à vista e observação opcional. Preservar despesas/cartões/boletos e evitar receita comum no cartão.

## Histórias
- Como titular, quero escolher receita antes de preencher os campos e ver apenas recebimento, descrição, valor e data.
- Como titular, quero que receita aumente o caixa e despesa à vista o reduza, com revisão humana dos meus dados.

## Critérios de aceite
- CA1: Dado o formulário, Tipo é o primeiro controle. Receita mostra Pix/Transferência/Dinheiro e Data do recebimento, sem cartão/parcelas/boleto/débito. Trocar tipo limpa categoria incompatível e resíduos de crédito.
- CA2: Dada receita comum, a RPC autenticada aceita apenas as três formas de recebimento, valor positivo, data válida e observação até2000caracteres; chamada inválida não grava nada. API antiga de estorno em cartão continua independente.
- CA3: Dada transferência recebida de terceiros, registro, listagem, filtros e edição reconhecem TRANSFERENCIA como forma real. Transferências entre contas próprias continuam na área de Contas bancárias e não são receita.
- CA4: Dada chave por tentativa, repetir a mesma receita retorna a mesma transação; reutilizar a chave com conteúdo diferente falha. Observação/categoria são gravadas na mesma transação financeira. Edição por substituição preserva observação e transfere a chave/hash da intenção original ao registro novo; repetir o pedido original retorna esse registro sem recriar receita. Nenhum efeito externo.
- CA5: Dados recebimentos e gastos à vista, carteira soma receitas e subtrai despesas uma vez. Compras no cartão e boletos mantêm regime de caixa existente (saída quando pagos); quitação de fatura não duplica consumo.
- CA6: Dado outro titular/anon, não altera receita alheia; validação/erro de rede são visíveis e botão sai de pendente. Observação renderizada como texto, sem HTML executável.
- CA7: Dados fluxos antigos de despesa/cartão/boleto, testes continuam válidos; interface cabe em320/768/1024/1440 e usa os tokens Ateliê (verde para entrada/telha para saída), sem dependências novas.

## Bordas
Troca crédito parcelado -> receita; categoria anterior; zero/negativo/valor fracionário em centavos; falha de rede após gravação; repetição/conflito de chave; observação longa ou HTML; conta própria x receita externa.

## Fora do escopo / decisão pendente
Importações, recorrências e estornos não são redesenhados. Sem alteração automática de receitas antigas. Caixa geral é o alvo desta fase; seleção/atualização direta de Bradesco/Itaú depende da resposta à pergunta assíncrona, sem escrita bancária até essa definição.

## Premissas e garantias
1. Atomicidade: nova RPC de recebimento engloba criação/categoria/observação.
2. Repetição: UUID por tentativa, trava e índice único por titular.
3. Concorrência: trava por titular/chave antes de consultar a tentativa anterior.
4. Falhas: timeout na chamada nova, catch/finally e feedback explícito.
5. Leitura: reaproveitar paginação/filtros existentes e selecionar observação nas duas consultas da lista.
6. Limites: centavos positivos limitados, descrição1–500, observação0–2000; titular inferido da sessão, categoria do mesmo titular/tipo.
Trade-off: recebimentos têm RPC específica para proteger o fluxo normal; motor de crédito/estorno existente é preservado, ampliando apenas a forma à vista TRANSFERENCIA.

## Fases
1. Testes vermelhos e formulário guiado pelo tipo.
2. Migração incremental, recebimento atômico e integração da lista/filtros.
3. SQL descartável, regressões, build/lint/segurança e revisão.
