# Previsão de saldo, reservas assistidas e regras pessoais
**Pronto significa:** CA1–CA9 comprovados por testes de domínio, SQL local, navegador, build/lint/segurança e revisão independente. Status: implementação local validada em20/10/2026; provas e limites em .work/LOG.md. Instalação remota e publicação fora desta etapa.

## Objetivo
Integrar receitas previstas e compromissos a uma previsão de caixa, tornar as sugestões dos cofrinhos mais explicáveis com o histórico disponível e facilitar regras pessoais de categorização. Reaproveitar Planejamento, Reserva inteligente e regras já existentes.

## Histórias
- Como titular, quero saber se faltará dinheiro antes do próximo salário, mesmo quando o mês termina positivo.
- Como titular, quero sugestões por cofrinho que expliquem os dados usados e o que falta conferir.
- Como titular, quero corrigir uma categoria e escolher quando essa correção deve valer para próximos lançamentos semelhantes.

## Critérios de aceite
- CA1: Dado saldo-base com data e origem identificadas, ao conferir a previsão dos próximos90dias, então exibir saldo calculado atual separado do saldo projetado, receitas esperadas, saídas e menor saldo com data. Caixa calculado no aplicativo não é apresentado como saldo bancário conciliado. Permitir confirmar/ajustar a base da simulação sem lançar dinheiro no caixa.
- CA2: Dados eventos financeiros, então projetar por data de entrada/saída efetiva esperada: receitas recorrentes ainda previstas, faturas/parcelas/boletos e despesas/assinaturas conhecidas. Receita recebida não soma novamente, ocorrência pulada não entra; própria transferência não vira renda. Compra no cartão e pagamento da fatura contam uma saída, no vencimento; assinatura já cobrada não duplica previsão. Contas vencidas ficam pendentes explícitas na simulação; receita atrasada sem confirmação não é presumida recebida hoje.
- CA3: Dado mês que fecha positivo mas fica negativo antes do salário, então destacar dia e valor do déficit. Eventos confirmados, previstos e estimados têm rótulos distintos e origem consultável. Ausência de histórico ou dado conhecido não vira promessa de saldo disponível; não inventar gastos variáveis nem datas de pagamento.
- CA4: Dados três meses anteriores com cobertura conferida, então reutilizar o motor conservador de reservas e mostrar fontes, meses, compromissos e capacidade restante. Com mês incompleto, listar precisamente contas/faturas/pendências faltantes e oferecer simulação identificada, sem tratar dado ausente como zero nem afirmar que fontes não cadastradas estão cobertas.
- CA5: Dadas metas, prioridades e intenção mensal, então sugerir valores por cofrinho limitados à capacidade calculada e descontar aportes líquidos já feitos. Oferecer carregar valores conhecidos do aplicativo para revisão, mantendo sua origem/data visíveis. Receita futura não aumenta o caixa real nem autoriza aporte hoje; nenhum aporte/transferência ocorre ao visualizar, simular ou salvar preferências. Mostrar por que uma meta recebe menos ou nada.
- CA6: Dada correção de categoria em Transações, então oferecer uma regra opcional com padrão editável e exemplos dos lançamentos que correspondem, separados por tipo RECEITA/DESPESA. Explicar que o padrão atual usa correspondência literal na descrição, não aprendizado automático. Não truncar descrição e salvar regra silenciosamente; padrão amplo e conflito com regra prioritária devem ser visíveis antes da confirmação.
- CA7: Dada aprovação da regra, então salvar categoria e regra atomicamente, com repetição segura e isolamento por titular; regra idêntica não duplica e conflito de categoria/prioridade é explícito. Nesta fase afeta o lançamento corrigido e os novos compatíveis; não reclassifica o histórico em massa. Remover regra não apaga categorias nem altera valores financeiros. Preservar precedência configurada e proteção da liquidação de fatura.
- CA8: Dadas leituras extensas, falha de rede ou duas abas, então usar consultas paginadas/limitadas, timeout e erros explícitos, sem mostrar informação parcial como previsão completa. Prévia de regra não confia em IDs/categoria de outro usuário. Dinheiro em centavos inteiros com limites e cálculo determinístico; operações de previsão não materializam lançamentos/ocorrências automaticamente.
- CA9: Dadas telas Planejamento/Cofrinhos/Transações, então integrar com navegação existente, dois temas e rótulos acessíveis. Testar teclado/axe, larguras320/375/768/1024/1440/1920 e screenshots320/768/1024/1440; preservar importação, conciliação, receitas recorrentes, reservas e classificação anteriores.

## Casos de borda
Virada de mês/ano e fevereiro; salário15/30; receita antecipada conjunta; assinatura já presente na fatura; fatura quitada e boleto vencido; falta de saldo inicial; conta/fatura ausente; duas fontes com mesmo lançamento conciliado; dados corrigidos durante revisão; aporte resgatado; meta concluída/arquivada; pagamentos entre contas próprias; mais de1000lançamentos; regra ampla, concorrente ou de tipo incompatível; nota/descrição com HTML.

## Fora do escopo
Pluggy/contratação externa, modelo de IA pago, renda garantida, movimentação automática de dinheiro, recomendação de investimento, aprovação automática de conciliação, reclassificação retroativa em massa e aplicação iOS. Não instalar migração remota, publicar ou enviar ao GitHub sem autorização de entrega. Não substituir estruturas existentes por um segundo sistema de planejamento.

## Perguntas e decisões propostas
- Horizonte inicial90dias, com evolução diária e resumo mensal; visão de compromissos12meses existente é preservada.
- Sugestões sempre assistidas: base/compromissos importados para revisão, mantendo modo manual. Dados históricos só entram como base conferida quando passam pelos critérios de cobertura já existentes.
- Regras opcionais somente após revisão, para o lançamento atual e futuros compatíveis; sem alterações retroativas em massa nesta fase.
- [x] Plano e decisões aprovados por Lucas em20/10/2026.

## Premissas e garantias
1. Atomicidade: correção e regra numa única transação; previsão não persiste movimentos financeiros.
2. Repetição: operações de regra com chave/identidade estável, sem duplicidade em retry; leituras sem efeitos financeiros.
3. Concorrência: validar versão/conflito e travar titular/regra na gravação, respeitando a prioridade vigente.
4. Dependências: timeout e falha explícita; sem APIs pagas nem novas credenciais; não substituir falha por valores zero.
5. Consultas: reutilizar paginação por cursor e índices; limitar janela/exemplos, sem buscar toda conta para cada cofrinho ou regra.
6. Limites: centavos seguros, datas válidas, padrão literal limitado e tipo/categoria do titular autenticado.
Trade-off: projeção determinística e revisão humana permitem explicar cada número; não prometem inferir despesas que ainda não foram registradas.

## Fases
1. Testes vermelhos de eventos/deduplicação/regime de caixa e saldo mínimo; implementação do motor e consulta de90dias sobre as fontes existentes.
2. Integração da previsão a Planejamento e dos dados conferidos a Cofrinhos, com simulação separada da estimativa e explicação por meta.
3. Prévia/editoração do padrão de regra e gravação atômica com revisão, limites e testes de repetição/conflito/RLS.
4. Regressões financeiras e SQL descartável, componentes, jornadas autenticadas, visual/performance/segurança e revisão independente; registrar provas e limites.
