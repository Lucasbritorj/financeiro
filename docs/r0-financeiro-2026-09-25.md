# R0 observado: servidor exclusivo no E2E

Base: 303659c2d73484a0b1ffed005d6349a5bd5031a5.
Tarefa: financeiro-e2e-servidor-exclusivo-v1. Execução: r0-20260925-e2e-01.

## Aceitação e resultado

Antes de editar foram registrados três critérios: porta ocupada deve abortar sem
encerrar servidor alheio; porta livre deve iniciar o aplicativo e passar o teste
de formulário; preservar fontes do aplicativo, Claude e configuração global.

Reprodução anterior: servidor HTTP fictício na porta do E2E recebeu três requests
e o teste renderiza-formulário passou, sem executar o aplicativo real.
Correção: reuseExistingServer=false também fora do CI.
Depois: porta ocupada retornou exit 1 com conflito antes da suíte, servidor
alheio continuou vivo; porta livre retornou exit 0 com o build local existente.
Uma tentativa de implementação, zero retrabalho. Diff check passou. Não repetimos
build, SQL ou a suíte inteira: o produto não mudou, somente a política do runner.

## Medição

Tempo até a leitura final de consumo: 1.25 minutos.
Janela de cinco horas: 90% usados antes, 96% depois (mesmo resetsAt 1790376064).
Variação observada: 6 pontos percentuais. Não converter em tokens, dólares ou
minutos de computação. A medição é da conta compartilhada, pode sofrer atraso e
atividade concorrente, e não cobre a gravação deste relatório nem a resposta final.
Modelo informado pelo ambiente: família GPT-6; variante e esforço não confirmados.

## Limite do experimento e decisão

Este é um R0 observado nesta conversa, NÃO uma baseline limpa independente:
o contexto extenso anterior e as ferramentas/instruções existentes permaneceram.
Não foi criado outro agente, tarefa ou harness. A tarefa foi escolhida pelo agente
entre riscos previamente encontrados; isso também limita comparação externa.
Passou tecnicamente na primeira tentativa, mas o consumo observado continua alto
para uma mudança pequena. Não demonstra economia e não justifica instalar Goose.

Próximo experimento: tarefa comparável, contexto novo com briefing curto, mesmo
modelo/esforço identificado e sem atividade concorrente durante a medição. Mudar
somente o contexto primeiro, sem misturar troca de modelo/harness. Se não houver
medição por execução, manter explícita a limitação da franquia compartilhada.

## Evidências e reversão

.consolidacao/r0-server-check.py reproduz os três cenários (baseline/occupied/free).
Logs e JSON: .consolidacao/r0-baseline.*, r0-occupied.* e r0-free.*.
O cenário baseline exige a configuração antiga; os demais usam a corrigida.
Catálogo e ledger existentes do codex-engineering-platform receberam novos registros.
A reversão deve atingir somente este commit, preservando trabalho posterior; ela
reintroduz o risco de validar um servidor diferente. Nenhum push foi realizado.
