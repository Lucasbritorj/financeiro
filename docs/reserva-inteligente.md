# Planejamento de reservas

Na tela Cofrinhos, o painel **Quanto posso reservar?** permite salvar intenção mensal, margem, prioridades e valores declarados de caixa/compromissos. Salvar preferências nunca cria aporte ou lançamento.

## Uso
1. Cadastre todas as contas e cartões relevantes; importe, concilie e confira extratos/faturas.
2. Informe o caixa realmente livre hoje, excluindo valores reservados, e todos os compromissos que ainda serão pagos neste mês.
3. Informe receita e gasto para simular, ou deixe ambos vazios para usar os três meses anteriores, quando a cobertura mínima estiver atendida.
4. Escolha a prioridade das metas e confirme que conferiu os dados. A tela explica a proposta.
5. Registre somente as reservas efetivamente realizadas nos controles de aporte existentes.

## Regras
- Caixa desconhecido ou bases insuficientes não significam capacidade zero: a tela informa falta de dados.
- A cobertura requer início/fechamento das contas cadastradas e faturas importadas ativas dos cartões cadastrados, sem linhas de extrato pendentes. Não descobre fontes ausentes nem certifica classificação/completude.
- Base histórica: menor receita e maior despesa dos três meses anteriores. Conta somente natureza CONSUMO; pagamentos de faturas e transferências não somam novamente.
- Despesa-base usa o maior entre o gasto mensal e o planejamento conhecido do mês de cartões/assinaturas. Esses valores não são somados entre si.
- Sugestão é limitada pela intenção restante, capacidade mensal e caixa após compromissos/margem. Aportes líquidos já feitos no mês (inclusive em cofrinhos arquivados) reduzem intenção e capacidade.
- Distribuição atende primeiro a contribuição necessária por prioridade/prazo, e só depois antecipa objetivos. Nunca ultrapassa o valor que falta na meta.
- Sem rendimentos presumidos. Receita observada não é renda garantida; bônus e exceções exigem conferência do titular. As entradas manuais não são sincronizadas automaticamente com bancos.
- Preferências pertencem ao titular. Em gravações simultâneas, vale a última gravação. Metas/aportes continuam separados das preferências.

## Instalação e limites da entrega
Aplicar `20261019200000_preferencias_reserva.sql` após as migrações anteriores, com backup e conferência do alvo antes da instalação remota; depois publicar a aplicação. Nesta obra apenas o ambiente local foi alterado. Não requer novas variáveis, chaves ou dependências.
RLS restringe a leitura; a gravação só ocorre pela RPC autenticada `salvar_preferencias_reserva`, que valida valores e titularidade das prioridades.
Sem a migração ou diante de erro/timeout, o painel informa indisponibilidade e não gera estimativa falsa. Os controles existentes de cofrinhos permanecem independentes do novo painel.
