# Spec — Planejamento e importação segura
**Pronto significa:** CA1–CA12 comprovados por testes reais, build/lint, SQL local e jornada autenticada; revisão independente aprovada.
Status: execução autorizada pelo pedido “execute isso” · Nível: spec first.

## Objetivo
Facilitar a conferência de faturas, permitir reverter importações identificáveis com segurança e antecipar compromissos e alertas no aplicativo.

## Histórias
- Como usuário, quero conferir as datas incertas em conjunto para reduzir trabalho repetitivo.
- Como usuário, quero ver os próximos meses por cartão para planejar compromissos.
- Como usuário, quero conhecer o impacto e desfazer uma importação para corrigir erros.
- Como usuário, quero alertas de vencimento e possíveis mudanças nas assinaturas para investigar cobranças.
- Como responsável, quero testes autenticados automáticos para evitar regressões nas entregas.

## Critérios de aceite
- **CA1** — Dadas datas sem ano, quando reviso a fatura, então vejo a quantidade e posso filtrar apenas as pendentes e confirmar em conjunto após conferir; linhas ignoradas/informativas não são confirmadas.
- **CA2** — Dada uma data confirmada, quando altero sua data, então ela volta a exigir conferência; confirmar datas não elimina divergências de total nem decisões de assinatura.
- **CA3** — Dado um mês inicial válido, quando abro Planejamento, então vejo 12 meses com valores por cartão e separação entre registrado, parcelas previstas e assinaturas previstas; total comprometido é a soma dessas partes.
- **CA4** — Dadas cobranças já registradas, quando projeto parcelas/assinaturas, então não somo novamente a parcela confirmada nem a assinatura vinculada naquele mês; ciclos trimestrais/semestrais/anuais e fim do mês respeitam a agenda, e pausadas/canceladas não são projetadas.
- **CA5** — Dado o histórico de importações, quando solicito desfazer, então vejo quantidade, valores, vínculos preservados e impedimentos antes de confirmar, sem remover nada na prévia.
- **CA6** — Dado um lote elegível, quando confirmo desfazer, então apenas seus lançamentos são retirados dos totais em uma transação, o histórico registra a reversão e reimportar o mesmo arquivo é permitido; repetir a reversão não duplica efeitos.
- **CA7** — Dados pagamentos, fatura fechada/paga, edição posterior ou importação antiga de extrato sem vínculo comprovado, quando tento desfazer, então a operação é bloqueada integralmente; cadastros e vínculos compartilhados são preservados e outro usuário não acessa o lote.
- **CA8** — Dadas contas/assinaturas vencidas ou vencendo em até 7 dias, quando consulto os alertas, então vejo data, valor e acesso à tela correspondente; alertas de assinatura não afirmam pagamento ou inadimplência.
- **CA9** — Dado histórico vinculado de uma assinatura, quando a cobrança mais recente supera a anterior, então há alerta de possível aumento; contratos ativos com mesmo nome normalizado e cartão geram alerta de possível duplicidade, sem alteração automática.
- **CA10** — Dado um PR/push master, quando o CI executa, então um job inicia Supabase local, aplica migrações e roda todas as jornadas autenticadas em desktop/celular usando somente credenciais efêmeras locais, sem segredos do projeto remoto.
- **CA11** — Dado falha, conta vazia ou ausência da migração, quando abro as funções novas, então há estado vazio/erro recuperável sem apresentar totais parciais como completos; consultas têm timeout e paginação.
- **CA12** — Dadas as telas alteradas, quando uso teclado e larguras 320/375/768/1024/1440/1920 nos dois temas, então valores permanecem legíveis, sem overflow, axe sem violações e Lighthouse da rota autenticada registra desempenho/acessibilidade.

## Casos de borda
- Datas inválidas, ano virando, fevereiro/dia 31, contratos atrasados, assinatura sem cartão, múltiplas cobranças vinculadas no mês, lote vazio/duplicado, reversão simultânea, cobrança de outro lote no mesmo plano.
- Extratos antigos não têm vínculo inequívoco com as transações: bloquear reversão automática desses lotes, sem inferir por valor/data. Novas importações terão vínculo explícito.
- Lotes com parcelamentos anteriores à nova procedência também ficam bloqueados, evitando previsões órfãs após retirar cobranças.
- Contratos de assinatura permanecem cadastrados após desfazer; a prévia informa isso e a reimportação permite vinculá-los. Planos criados pelo lote são removidos somente se não compartilhados.

## Fora do escopo
- Notificações por e-mail/push, cobranças automáticas, OCR, Open Finance, política de backup e recuperação real de senha.
- Reverter automaticamente dados reais do usuário; instalação remota/publicação serão feitas somente no escopo autorizado e após validação.

## Perguntas abertas e premissas
- Sem bloqueios: adotar alertas dentro do aplicativo, janela de 7 dias e projeção de 12 meses a partir do mês escolhido; são padrões reversíveis da implementação autorizada.
- Nome igual é indício, nunca certeza de cobrança duplicada; aumento usa somente histórico vinculado, sem adivinhar contrato pelo texto.

## Premissas e garantias
- Atomicidade: reversão e seu registro no banco acontecem na mesma transação; nenhuma chamada externa acompanha a gravação.
- Idempotência: histórico de reversão e chaves de lote impedem efeitos repetidos; uma nova importação usa uma nova chave.
- Concorrência: trava por usuário, cartão e linhas envolvidas; bloqueios financeiros são revalidados durante a confirmação.
- Dependências: timeout nas consultas e mensagem recuperável; sem repetição cega de gravações.
- Eficiência: paginação por cursor e filtros por período; agregação em memória dos conjuntos completos.
- Entrada: UUIDs/tipos/intervalos validados no servidor e RLS mantida; arquivos e dados particulares não entram no Git.
- Trade-off: preservar contratos e bloquear reversões ambíguas reduz automação para proteger histórico financeiro.
