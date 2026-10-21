# Receitas recorrentes com confirmação
**Pronto significa:** CA1–CA9 comprovados por testes locais, SQL isolado, navegador, build/lint/segurança e revisão independente. Status: aprovada por Lucas em20/10/2026, com confirmação antes de entrar no caixa.

## Objetivo
Planejar receitas mensais em uma ou mais datas, sem tratar dinheiro esperado como recebido. Permitir antecipação, recebimento conjunto e exceções de férias sem duplicar renda nem cancelar meses futuros.

## Histórias
- Como titular, quero prever salário nos dias15 e30, com valores separados.
- Como titular, quero confirmar data/valor reais, pular uma ocorrência e manter as próximas.
- Como titular, quero registrar duas partes recebidas juntas em uma única entrada no caixa.

## Critérios de aceite
- CA1: Dada receita recorrente, ao cadastrar descrição, valor por parte, meio Pix/transferência/dinheiro, início e um ou mais dias1–31 distintos, então criar regra e previsões, sem receita efetivada. Tipo vem primeiro; cartão/parcelas não aparecem. Opção visível junto ao formulário de receita e gestão em Recorrências.
- CA2: Dado calendário mensal, quando o dia não existir, então usar último dia do mês, preservando o dia contratado no próximo mês: dia30 em fevereiro→28/29 e março→30. Sem ajuste automático por feriado/dia útil nesta fase.
- CA3: Dada previsão pendente, quando confirmar recebimento, então usar data/valor reais positivos e observação opcional, gravar receita e vínculo na mesma transação e aumentar caixa exatamente uma vez. Sem confirmação, nenhuma entrada no caixa nem receita realizada em análise.
- CA4: Dada ocorrência do dia15 nas férias, quando marcar “Não recebi nesta data”, então registrar ocorrência pulada com motivo opcional, sem dinheiro movimentado, e manter a ocorrência do dia30 e os meses seguintes. Permitir desfazer essa marcação; pausar/excluir regra é ação distinta.
- CA5: Dadas duas ocorrências selecionadas, quando confirmar “Recebi juntas/antecipado”, então mostrar resumo, solicitar data/total efetivamente recebido e gerar uma única transação vinculada às duas. As datas originais ficam no histórico e não geram entradas novamente no dia15/30.
- CA6: Dada confirmação feita por engano, quando desfazer, então remover efeito financeiro e devolver ocorrências à revisão atomicamente. Recebimento conjunto é desfeito como conjunto; bloqueios de conciliação/período fechado existentes continuam válidos e são explicados.
- CA7: Dadas duas abas ou resposta perdida, quando repetir mesma confirmação/pulo, então não duplicar entradas; ações conflitantes falham claramente. Usuário alheio/anon não lê nem altera regras/ocorrências/recebimentos.
- CA8: Dadas receitas recorrentes já cadastradas, instalação preserva transações históricas e passa somente ocorrências futuras ainda não materializadas ao fluxo de confirmação. Despesas recorrentes e assinaturas mantêm seus contratos. Meses ausentes reaparecem como pendências, sem entradas retroativas automáticas; consultas e geração têm limites/paginação.
- CA9: Dada interface de Recorrências, então distinguir Prevista, Recebida e Não recebida; explicar atraso sem chamar de entrada real. Erros de rede liberam controles sem perder formulário. Teclado, axe e larguras320/768/1024/1440 em dois temas passam; sem dependências novas.

## Casos de borda
Fevereiro bissexto; dias30/31; duas datas que caem no último dia de fevereiro continuam sendo duas partes distintas; valor variável; recebimento antecipado no mês anterior; duas abas; erro após commit; edição de regra não reescreve ocorrências resolvidas; exclusão de regra mantém histórico; transferência própria não vira renda; confirmação já conciliada; recebimento importado não é vinculado automaticamente por semelhança.

## Fora do escopo
Prever férias/holerite sem dados fornecidos, interpretar automaticamente extrato como confirmação, cron externo, feriados bancários e mudanças no saldo de contas individuais. Não instalar migrações, publicar, enviar ao GitHub nem corrigir dados reais nesta obra sem autorização correspondente. Não redesenhar despesa recorrente/assinatura.

## Perguntas abertas
- [x] Confirmação humana antes de entrar no caixa e plano aprovados por Lucas em20/10/2026.

## Premissas e garantias
1. Atomicidade: ocorrência e receita/vínculo persistem ou falham juntas; desfazer segue a mesma regra.
2. Repetição: chave por operação e identidade única por regra/parte/mês; uma confirmação pode resolver mais de uma ocorrência.
3. Concorrência: travas das ocorrências em ordem estável e constraints; sem ler saldo e regravar fora da transação.
4. Dependências: chamadas com timeout e erro explícito; sem serviços externos novos, sem retries indiscriminados.
5. Consultas: índice por titular/status/data, consultas por janela e paginação; não materializar histórico ilimitado ao abrir dashboard.
6. Limites: centavos inteiros positivos dentro do limite do domínio, datas válidas, dias distintos, descrição/observação limitadas e titular inferido da sessão.
Trade-off: confirmação humana evita renda fictícia; exige uma ação do titular quando o dinheiro chega. Reaproveitar recorrências existentes com ocorrências identificadas, sem criar outro mecanismo automático de saldo.

## Fases
1. Aprovar comportamento e escrever testes de calendário/estados/SQL que falhem antes da implementação.
2. Migração incremental: partes/ocorrências, estados, confirmação agrupada, pular/desfazer, RLS e integração do aplicador existente.
3. Integrar formulário de receitas e painel de revisão; manter os fluxos de despesas/assinaturas.
4. Executar regressões de dinheiro/SQL/concorrência, navegador, build/lint/segurança, revisão independente e registrar evidências. Publicação posterior.
