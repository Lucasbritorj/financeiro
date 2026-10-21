# Planejamento e importação segura

Implementação de [spec](specs/planejamento-e-importacao-segura.md), autorizada e publicada em 17/10/2026 pelo [PR16](https://github.com/Lucasbritorj/financeiro/pull/16), versão `1415937`. Migração instalada, dados financeiros preservados e novo job autenticado executado com sucesso no GitHub.

- Importar: filtre as datas pendentes, confira dia/mês/ano e confirme-as em conjunto. Editar uma data exige nova conferência. Divergências e decisões de assinatura continuam obrigatórias.
- Planejamento: escolha o mês inicial para consultar 12 meses por cartão. Registrado, parcelas previstas e assinaturas previstas permanecem separados; estimativas não criam lançamentos ou faturas. A agenda respeita ciclo, dia ancorado e fechamento atual do cartão. Cobranças vinculadas substituem previsões no mês correspondente.
- Pontos de atenção: contas vencidas ou vencendo em 7 dias, próximas cobranças de assinaturas, possíveis aumentos e contratos com mesmo nome/cartão. Alertas aparecem no Dashboard e no Planejamento, sem envio externo ou alteração automática.
- Histórico de importações: confira a prévia e confirme pelo diálogo antes de desfazer. Lançamentos saem dos totais e planos exclusivos criados pelo lote podem ser removidos. Cartões, categorias, faturas, contratos e planos compartilhados permanecem. O mesmo arquivo pode ser reimportado usando uma nova revisão.

## Limites e proteção

Faturas fechadas/pagas, lançamentos editados/removidos, extratos antigos sem vínculo comprovado e parcelamentos antigos sem procedência são bloqueados. Não se deduz vínculo por data/valor. Ao reimportar uma assinatura cujo contrato permaneceu, selecione vincular ao contrato existente.

Registrado inclui valores já pagos; comprometido é a soma dos registros e previsões existentes, não o saldo ainda a pagar. Assinaturas sem cartão ficam em grupo separado. Aumento usa apenas histórico vinculado, incluindo ciclos anuais; não afirma reajuste nem cobrança indevida. Falhas não são convertidas em totais parciais.

## Provas locais

| Critérios | Evidência |
|---|---|
| CA1–CA2 | 10 testes de componente da importação, com regressão vermelha/verde e reconferência após edição |
| CA3–CA4/CA8–CA9 | 9 unitários de domínio; 2 regressões de consulta para assinatura anual e estabilidade dos alertas ao mudar mês |
| CA5–CA7 | 24 asserts de reversão/RLS; suíte SQL com 15 arquivos e upgrade de 36 migrações; concorrência real entre duas reversões e entre pagamento/reversão |
| CA11–CA12 | Jornada autenticada com conta local temporária: Planejamento, prévia, reversão, reimportação e bloqueio do legado; seis larguras/dois temas, axe zero, teclado e reduced-motion; Lighthouse autenticado desempenho 91/acessibilidade 100 |
| Regressões | 593 unitários; 33 jornadas aprovadas na rodada ampla e reexecução final das 4 jornadas alteradas aprovada após corrigir a preparação da medição Lighthouse; demais componentes válidos preservados e arquivo do menu reexecutado após incluir a nova rota |
| Revisão | Segunda opinião independente somente leitura aprovada após corrigir recorte do histórico anual; lint zero erros, 20 avisos existentes; auditoria de produção zero vulnerabilidades |
| CA10 | [CI39061774439](https://github.com/Lucasbritorj/financeiro/actions/runs/39061774439) aprovado, incluindo 34 testes de navegador no job com Supabase descartável; demais verificações do PR aprovadas |

## Instalação e CI

Aplicar `20261017180000_planejamento_reversao_importacao.sql` antes da nova interface. É aditiva, substitui as duas funções de confirmação para registrar procedência e permitir nova revisão após desfazer. Não reverte dados existentes. Preparar cópia privada, conferir contagens/dados/permissões e usar o deployment anterior para retorno de código.

O job autenticado instala a mesma versão fixa da CLI testada localmente, inicia Supabase descartável, aplica todas as migrações e executa `test:e2e:local` em desktop/celular. As credenciais vêm somente desse banco local, são mascaradas no log e não são salvas no repositório. Não depende de segredos do projeto remoto.

Instalação executada: cópia privada das 14 tabelas financeiras e definições anteriores preservada; contagens e hashes dos campos anteriores permaneceram iguais após adicionar as colunas. Somente as duas funções esperadas foram alteradas. Views invoker, RLS e permissões corretos, zero reversões executadas e nenhuma migração pendente.

Produção READY em [Planejamento](https://financeiro-brito-s.vercel.app/planejamento), versão imutável `financeiro-l2pcpf5hw-brito-s.vercel.app`, domínio confirmado nessa publicação. O layout autenticado e as gravações foram verificados com contas temporárias locais; não foram criados lançamentos de teste em produção. Retorno de código disponível pelo deployment `financeiro-6foxl10nr-brito-s.vercel.app`.

[CI pós-merge39062221959](https://github.com/Lucasbritorj/financeiro/actions/runs/39062221959) também aprovado, incluindo o novo job autenticado. Oito rotas de acesso e login/recuperação no navegador aprovados na produção, zero pageerror; consulta de logs sem ocorrências de erro no intervalo conferido.
