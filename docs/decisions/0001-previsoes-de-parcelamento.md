# 0001 — Previsões separadas das cobranças confirmadas
Data: 2026-10-17 · Status: aceita

## Contexto
A fatura pode começar na terceira parcela de uma compra. Gravar parcelas anteriores ou tratar previsões como gastos criaria fatos financeiros inexistentes. A importação seguinte precisa confirmar uma previsão sem somar outra despesa.

## Decisão
Registrar cada cobrança efetiva como despesa de crédito na competência escolhida. Guardar plano, parcela e vínculo em tabelas próprias e calcular futuras em uma view com isolamento por usuário. A confirmação de fatura usa RPC própria e transação única; não altera o importador de extrato. Plano entre meses e contrato de assinatura são escolhidos explicitamente na revisão.

## Alternativas descartadas
- Materializar todas as parcelas no razão — inventaria histórico e misturaria estimativas com despesas.
- Inferir a identidade por nome e valor — une compras legítimas iguais e contratos distintos.
- Registrar tudo como débito — perde cartão, fatura e competência.

## Consequências
Valores efetivos continuam compatíveis com relatórios existentes. Previsões têm visualização e edição próprias em Importar → Fatura. Antecipações, estornos e layouts não reconhecidos exigem revisão explícita; não há suporte universal presumido.
