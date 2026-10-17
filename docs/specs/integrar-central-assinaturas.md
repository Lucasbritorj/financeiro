# Spec — Integrar Central de Assinaturas
**Pronto significa:** CA1–CA6 passam em testes locais de domínio, componentes, SQL e navegador; build, segurança e revisão aprovados.
Status: aprovada pela instrução «execute então», após comparação das branches.

## Objetivo
Integrar a implementação existente de 07/10 e seus complementos de 11/10 às correções locais, sem recriar a funcionalidade nem perder histórico financeiro.

## Histórias
- Como usuário, quero cadastrar, editar, pausar, reativar e cancelar assinaturas, inclusive no cartão.
- Como usuário, quero acompanhar próximas cobranças, custo mensal/anual e impacto por cartão.
- Como mantenedor, quero preservar correções atuais e verificar a integração em serviços locais reais.

## Critérios de aceite
- **CA1** — Dadas as branches existentes, quando integradas, então há rota/menu/comando de assinaturas, permanecem recuperação/CSV/edições de hoje e a auditoria de dependências roda no CI.
- **CA2** — Dadas assinaturas com periodicidades e status variados, quando calculados resumos, então apenas ativas compõem custos e percentuais e as próximas cobranças futuras não somem por haver cobranças vencidas.
- **CA3** — Dado usuário autenticado, quando cria/edita/alterna/cancela, então dados persistem, categorias/cartões alheios são recusados e falhas de rede não travam os formulários nem escondem dados como lista vazia.
- **CA4** — Dadas cobranças vencidas, quando aplicado o motor repetidamente, então assinaturas apenas avançam a agenda e não criam despesas/faturas; recorrências comuns continuam criando cada ocorrência uma única vez. Pausar/cancelar não avança assinaturas e alterações não reescrevem histórico. A ordem real das migrações preserva esses contratos.
- **CA5** — Dado Supabase local e conta temporária, quando a jornada de assinaturas é executada em desktop e celular, então criar/editar/pausar/reativar/cancelar e persistência são verificadas; não há overflow e a tela segue o Ateliê.
- **CA6** — Dada a integração, quando executadas verificações de entrega, então unitários/componentes/SQL/build passam, segurança é conferida e pendências de instalação são documentadas com precisão.

## Casos de borda
- Meses curtos, ciclo anual, centavos, cartões removidos, lista vazia/grande, cobrança vencida, erros de rede, repetição, acesso entre usuários e migrações anteriores à já publicada.

## Fora do escopo
- Criar assistente IA, Open Finance, contas bancárias, novos produtos ou automatizar cobranças reais em provedores.
- Publicar, aplicar migrações remotas, fazer push/merge no GitHub ou mudar proteção de acesso sem a aprovação específica da etapa.

## Perguntas abertas e premissas
- Nenhuma bloqueante: integrar a implementação mais completa existente; assinaturas acompanham contratos e agenda, enquanto despesas reais continuam vindo da fatura/lançamentos. Cancelar no Ateliê não cancela no fornecedor.

## Premissas e garantias
1. Banco: transações atômicas; nenhuma chamada a provedores de assinatura.
2. Repetição: reaplicar o motor não duplica ocorrências.
3. Concorrência: preservar travas e isolamento por usuário do banco.
4. Rede: clientes mantêm timeout existente, falhas visíveis e bloqueio de envio liberado no finally.
5. Leitura: não apresentar totais truncados como completos.
6. Validação: valor/data/status e propriedade também conferidos no SQL.
7. Trade-off: reaproveitar a branch evita duplicar regras; migrações antigas serão testadas na ordem do repositório e qualquer correção necessária será aditiva.
