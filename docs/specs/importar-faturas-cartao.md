# Spec — Identificação e revisão de faturas de cartão
**Pronto significa:** CA1–CA12 comprovados por testes locais de domínio/SQL, regressões do extrato e jornada autenticada de importação; nenhuma gravação de teste em produção.
Status: aprovada pelo Lucas em 17/10/2026; execução iniciada na branch codex/importar-faturas-cartao.

## Objetivo
Importar faturas de cartão com revisão de gastos, compras parceladas e possíveis assinaturas, sem duplicar despesas. Prioridade confirmada: fatura Itaú em PDF; extrato bancário em CSV deve continuar funcionando.

## Histórias
- Como usuário, quero escolher entre extrato bancário e fatura de cartão para registrar cada arquivo corretamente.
- Como usuário, quero revisar o que foi reconhecido e corrigir dúvidas antes de gravar.
- Como usuário, quero registrar a parcela atual e prever as restantes sem inventar gastos anteriores.
- Como usuário, quero confirmar possíveis assinaturas e vinculá-las ao controle de contratos.
- Como usuário, quero importar meses seguintes sem repetir compras, parcelas ou assinaturas.

## Critérios de aceite
- **CA1 — Formatos:** dado o arquivo e seu contexto, quando lidos CSV/OFX/OFC/XLSX/PDF, então o fluxo usa uma estrutura comum de revisão; PDF Itaú tem exemplos representativos testados. Formato/layout sem leitura confiável informa a limitação e não confirma automaticamente.
- **CA2 — Contexto:** dada uma fatura, quando iniciar a revisão, então cartão e mês de referência são obrigatórios e confirmados; ausência de cartão oferece cadastro. Datas sem ano não usam o ano corrente por suposição.
- **CA3 — Identificação:** dadas linhas como compra comum, serviço conhecido e parcela 03/10, quando analisadas, então apresentam sugestão, evidência e possibilidade de correção; datas ou códigos semelhantes não viram parcelamento sem evidência suficiente.
- **CA4 — Parcelas:** dada a parcela 3/10 de R$100, quando confirmada, então registra R$100 na fatura escolhida e prevê sete parcelas de R$100; não cria parcelas 1/10 e 2/10. Valores futuros são estimativas editáveis e ficam separados dos gastos efetivos.
- **CA5 — Conciliação:** dada uma previsão 4/10, quando sua cobrança for importada depois, então o gasto efetivo substitui a previsão correspondente sem dobrar totais. Coincidência de nome/valor com duas compras exige escolha, nunca união silenciosa.
- **CA6 — Assinaturas:** dada uma possível assinatura, quando revisada, então pode ser confirmada, recusada ou ligada a contrato existente; cobrança registra uma despesa e contrato registra agenda. Uma única cobrança desconhecida não comprova recorrência; parcela finita não vira assinatura automaticamente.
- **CA7 — Linhas especiais:** dados pagamento, saldo, total, juros, estorno ou crédito, quando analisados, então não viram compras comuns silenciosamente. Pagamento/total ficam destacados e excluídos da soma de compras; juros são despesas revisáveis; créditos/estornos exigem tratamento compatível ou bloqueio explicado, sem convertê-los em receita comum.
- **CA8 — Conferência:** dadas linhas reconhecidas, descartadas e pendentes, quando exibidas, então mostram subtotais de cobranças, ajustes e previsões separados. Total informado da fatura é opcional quando não extraído; divergência exige revisão e confirmação explícita, sem completar valores inventados.
- **CA9 — Repetição:** dado reenvio do mesmo arquivo, duplo clique ou repetição após resposta perdida, quando confirmar, então não duplica lançamentos. Deduplicação considera conta, cartão, mês e identificadores; exportações diferentes e compras legítimas iguais têm revisão de ambiguidades.
- **CA10 — Integridade:** dado cartão/categoria/contrato de outro usuário, dado inválido, falha no lote ou concorrência, quando confirmar, então o servidor recusa ou desfaz integralmente a operação; não existem gravações parciais nem vínculo com cadastro excluído.
- **CA11 — Regressão:** dado extrato bancário CSV e os formatos já suportados, quando importados no modo extrato, então preservam sinal, categorias, deduplicação e conciliação de pagamento de fatura, sem criar consumo duplicado.
- **CA12 — Jornada:** dado usuário autenticado local, quando importar, corrigir, confirmar, recarregar e importar o mês seguinte, então gastos, parcelas e contratos persistem corretamente; revisão funciona em 320px e desktop, com teclado, sem erro de execução e sem violações axe na tela exercitada.

## Casos de borda
- PDF sem texto, protegido por senha, várias páginas, linhas quebradas, dois cartões na mesma fatura e fechamento na virada do ano; nenhum suporte presumido sem exemplo testado.
- Parcela 01/12 versus data 01/12; valor total da compra versus valor da parcela; parcela já existente; antecipação, cancelamento e valor futuro diferente do previsto.
- Nome intermediário de cobrança, assinatura anual, preço variável e múltiplos serviços do mesmo fornecedor; categoria e recorrência são decisões distintas.
- Arquivo vazio, teto atual de 10 MB/1000 linhas, leitura incompleta, falha de rede, duplo envio, lote repetido e edição/exclusão concorrente de cartão.
- Conta recém-zerada: sem histórico, cartão ou categorias; nenhum cadastro fictício ou cobrança automática para preencher ausências.

## Fora do escopo inicial
- OCR de PDF digitalizado, desbloqueio de PDF, Open Finance, envio da fatura a IA externa e garantia universal de todos os layouts bancários.
- Recriar gastos anteriores à fatura importada, executar pagamentos ou cancelar serviços no fornecedor.
- Agendar cobranças reais a partir de previsões. Publicação e migração remota seguem etapa operacional autorizada separada.

## Decisões e perguntas abertas
- Confirmado pelo Lucas: Itaú PDF primeiro; extrato pode ser CSV; arquitetura compartilhada entre formatos; parcela atual mais previsão das futuras.
- Testes com exemplos fictícios representativos; nenhum PDF real foi fornecido. Compatibilidade com a fatura particular do Lucas exige conferência posterior. Fatura real, texto extraído, dados pessoais e estados de sessão não entram no GitHub público.
- Regra aprovada com o plano: estorno/crédito sem suporte contábil bloqueia a linha e exige exclusão explícita, com aviso e conferência da diferença; não importar como receita.
- Decisão: planos de parcelamento e vínculos das cobranças em tabelas separadas; futuras são calculadas sem materializar despesas. Vínculo entre meses é explícito na revisão; nome/valor servem de sugestão, nunca de identidade.

## Premissas e garantias
- Atomicidade: gravação de cobranças, vínculos e contratos em uma transação no banco; nenhuma API externa necessária.
- Repetição: identificador de confirmação e restrições de unicidade no banco; resposta perdida não permite nova despesa.
- Concorrência: travas consistentes por conta/importação e validação final dos cadastros antes de gravar.
- Rede: timeout, erro explícito e tentativa segura; falha de leitura não apresenta totais parciais como completos.
- Consultas: leituras paginadas e agrupadas, sem consulta por linha; índices conforme os vínculos efetivamente usados.
- Validação: valores em centavos; cartão e dados por usuário; limites e validações repetidos no servidor, não apenas na interface.
- Trade-off: regras explicáveis e confirmação manual favorecem controle e privacidade, exigindo revisão nos casos ambíguos.

## Execução e provas
Seis fases em `.work/PLANO.md`, checklist em `.work/CHECKLIST.md`. Testes de negócio falham antes da implementação; SQL e gravações de teste somente em banco local confirmado. Instalação remota e publicação dependem da etapa operacional autorizada separada.
