# Spec — Fechar jornadas financeiras
**Pronto significa:** CA1–CA9 verificados pelos testes indicados no plano, build e revisão do diff; limitações externas registradas.
Status: aprovada pela instrução «execute a sua recomendação» · Nível: spec first

## Objetivo
Corrigir divergências dos relatórios e completar recuperação de acesso, edição e portabilidade dos dados existentes do Ateliê.

## Histórias
- Como usuário, quero números coerentes e históricos completos para conferir meus gastos.
- Como usuário, quero recuperar minha senha sem perder acesso aos dados.
- Como usuário, quero editar meus cadastros sem recriá-los ou modificar lançamentos passados.
- Como usuário, quero exportar as transações filtradas em CSV para conferência.
- Como mantenedor, quero provas locais dos fluxos financeiros e uma lista atual das pendências externas.

## Critérios de aceite
- **CA1** — Dadas compra e liquidação da fatura, quando Análise e Dashboard calculam o consumo, então a liquidação não soma novamente; a consulta e a normalização preservam natureza.
- **CA2** — Dadas mais de 1.000 transações no período, quando os relatórios consultam dados, então percorrem páginas por último ID até o fim, sem deslocamento por inserções/exclusões anteriores ao cursor; uma falha impede exibir um total parcial como completo. Não promete snapshot transacional entre chamadas.
- **CA3** — Dadas mais de 24 faturas, quando o usuário navega pelo histórico, então alcança faturas anteriores e pode voltar às mais recentes.
- **CA4** — Dado usuário sem acesso, quando solicita recuperação, então recebe mensagem neutra; um código válido permite definir senha confirmada com 8+ caracteres; código ausente/inválido e falha de rede exibem erro recuperável.
- **CA5** — Dadas transações filtradas, quando exportadas, então o CSV inclui todas as páginas, centavos exatos, campos escapados e proteção contra fórmulas; ausência de sessão recusa acesso e falha não entrega arquivo parcial.
- **CA6** — Dados cadastros próprios, quando editados, então cartão aceita nome/limite/dias, categoria nome/cor/ícone, cofrinho nome/alvo/prazo/horizonte e recorrência descrição/valor/tipo/forma/categoria/dia; saldo e lançamentos anteriores permanecem intactos; outro usuário e valores inválidos são recusados.
- **CA7** — Dado ambiente de testes local, quando executadas as jornadas de importação/conciliação, edição, pagamento e estorno, então há provas de persistência, isolamento e ausência de contagem dupla; a cobertura de navegador distingue serviços reais de simulados.
- **CA8** — Dada instalação não inspecionada remotamente, quando documentada a entrega, então há procedimento somente de leitura para conferir migrações/autenticação/backups e pendências reais separadas das ideias futuras.
- **CA9** — Dados os três alertas altos encontrados na revisão, quando atualizadas as dependências existentes, então a auditoria de produção não reporta alertas altos/críticos e build/jornadas continuam passando.

## Casos de borda
- Lista vazia, empate na ordenação, última página cheia, erro em página intermediária e filtro inválido.
- Sessão expirada, recuperação expirada/reutilizada, senhas diferentes e pedido repetido.
- Limite abaixo do crédito comprometido, dia inválido, categoria alheia/incompatível, alvo abaixo do saldo e prazo vencido existente.
- Descrição contendo separadores, aspas, quebras de linha e fórmulas de planilha.

## Fora do escopo
- IA, Open Finance, notificações e novos modelos de conta/orçamento.
- Aplicar migrações, enviar e-mails a pessoas reais, deploy ou mudar configurações remotas.
- Recalcular faturas existentes ao editar datas de cartão; alterar ocorrências já criadas ao editar recorrência.

## Perguntas abertas
- Nenhuma bloqueante. Premissas: CSV respeita os filtros da lista; edição afeta cadastro/futuras operações; recuperar senha usa o fluxo PKCE já adotado pelo cliente Supabase SSR.

## Premissas e garantias
1. Escrita dupla: nenhuma edição chama serviço externo junto da gravação no banco.
2. Repetição: edições substituem campos; botões bloqueiam envio pendente, sem repetição automática de escrita.
3. Concorrência: cartão é travado antes de conferir crédito; edições de cadastro preservam saldos e histórico.
4. Dependências: erros são visíveis, consultas têm timeout e recuperação não revela cadastro de e-mail.
5. Consultas: páginas com ordenação estável e filtros compartilhados; sem truncamento silencioso.
6. Entrada: centavos inteiros, limites e propriedade validados também no banco, com privilégios explícitos.
7. Trade-off: reutilizar os relatórios e buscar páginas completas evita novo modelo de agregação agora, ao custo de mais leitura em históricos grandes.
