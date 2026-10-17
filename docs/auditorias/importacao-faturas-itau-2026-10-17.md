# Auditoria pós-importação — correções necessárias

Data: 17/10/2026. Escopo: avaliar a importação efetivamente realizada e anotar problemas, sem modificar código nem dados financeiros. Este arquivo é sanitizado: valores, descrições e registros reais ficam fora do repositório público. Relatório privado ignorado pelo Git em `.work/tooling/auditoria-fatura-2026-10-17.md`.

## Conclusão

Não usar os totais atuais como prova de importação correta da fatura. A execução observada passou pelo fluxo genérico de extrato, não pelo de faturas. Isso impediu aplicar a revisão de cartão, competência, parcelas e contratos. Há também problemas de leitura que precisam ser corrigidos mesmo no fluxo novo.

## Achados priorizados

| ID | Prioridade | Evidência e causa | Correção e aceite esperado |
|---|---|---|---|
| FAT-01 | Crítica | Fluxo observado registrado em importacoes/importacao_linhas, sem lotes_fatura ou cobranças vinculadas. O seletor começa em extrato (`src/components/importador-csv/index.tsx:14`); confirmar_importacao grava débito/sem cartão/uma parcela (`supabase/migrations/20260929120000_confirmar_importacao_fatura_ja_paga.sql:46`). | Escolha explícita antes do upload, detecção/alerta de fatura e bloqueio de confirmação incompatível. Fatura não pode virar extrato sem esclarecimento inequívoco. |
| FAT-02 | Crítica | Linha de pagamento foi gravada como CONSUMO. O leitor PDF de extrato trata valor sem C como despesa (`src/lib/pdf-extrato.ts:52`); a heurística de pagamento exige descrições mais específicas e uma fatura compatível. | Destacar pagamento/total/estorno antes da gravação; não transformar ambiguidade em novo consumo silenciosamente. Não remover qualquer palavra pagamento sem contexto. |
| FAT-03 | Crítica | PDF original confirmou duas tabelas lado a lado. A extração reproduziu integralmente os registros persistidos: pagamento combinado com compra e valor em moeda estrangeira associado à compra de outra coluna. Agrupar apenas por coordenada Y junta colunas (`src/lib/leitura-arquivo.ts:110`), e o parser usa o último valor (`src/lib/pdf-extrato.ts:83`). | Leitura por região/coluna e preservação de linha original. Múltiplas datas/valores ambíguos bloqueiam ou exigem revisão; não escolher arbitrariamente o último número. |
| FAT-04 | Alta | PDF original confirmou seção explícita de próximas faturas; suas linhas foram contabilizadas como despesas atuais. O novo parser também aceita essas seções como cobranças atuais em reprodução fictícia. | Interpretar cabeçalhos/seções; separar atual, futuras e resumo. Parcela futura não entra como cobrança da fatura atual. Antecipação exige decisão explícita. |
| FAT-05 | Alta | Datas de compra foram usadas como datas dos lançamentos, incluindo mês posterior ao vencimento informado. O fluxo de extrato completa ano ausente pelo ano corrente (`src/lib/leitura-arquivo.ts:29`). | Obter ano/contexto da fatura e revisar mês/competência; datas sem ano e compras de ano anterior precisam regressões. Não inventar ano sem evidência. |
| FAT-06 | Alta | Análise seleciona mês corrente e agrega data_compra (`src/app/(protegido)/analise/page.tsx:20`). Não usa a competência de cobrança da fatura; parcelas importadas podem aparecer como histórico de meses de compra. | Tornar explícita a visão compra versus competência; crédito por cobrança deve ter período consistente com fatura. Testar um único PDF sem fabricar histórico mensal. |
| FAT-07 | Média | Motor reproduz Mês sob controle com dados incompletos/sem renda; fallback afirma ritmo dos meses anteriores (`src/lib/analise.ts:58`). | Estado insuficiente/inconclusivo quando não há base confiável. Ausência de alerta não prova equilíbrio nem histórico estável. |
| FAT-08 | Média | Sem contratos/vínculos de assinatura no fluxo observado. A leitura por catálogo não sugere assinatura para as descrições disponíveis; há serviço misturado a linha de pagamento. | Corrigir extração primeiro e permitir confirmar serviço/periodicidade. Não classificar compras parceladas de marketplace como assinatura por conter nome de fornecedor. |
| FAT-09 | Média | Categorias ausentes e todos os registros sem categoria; o fluxo de extrato não exige comparação com total informado e termina em alerta genérico de quantidade. | Orientação inicial de categorias, resumo de valores, pendências e total comparável antes de confirmar; oferecer histórico/recuperação segura por lote. |
| FAT-10 | Alta | Encargo de IOF da compra internacional consta em linha sem data e foi omitido. O documento mistura valor cobrado em reais, valor em moeda estrangeira e taxa de conversão. | Separar moeda original, valor efetivamente cobrado e encargo; preservar o vínculo e reconciliar o total sem criar diferença artificial. |
| FAT-11 | Média | Documento mostra valores de parcelas futuras diferentes da parcela atual por arredondamento. Repetir o valor atual em todos os meses produz diferença contra o total futuro informado. | Preservar valores futuros explícitos e a origem das estimativas; validar soma e permitir revisão de diferenças. Não assumir igualdade de todas as parcelas. |

## Provas e limites

- Consultas ao projeto confirmado executadas com BEGIN READ ONLY e timeout, limitadas à conta solicitante. Snapshot privado fora do Git; nenhum dado alterado.
- Reproduções locais sintéticas: duas datas/valores na mesma linha geram data e descrição combinadas no parser de extrato; parser novo descarta essa linha sem reconstrução; seção futura é aceita como atual. Nenhum teste executou escrita no banco remoto.
- Motor Análise executado localmente sobre os registros lidos: reproduziu o título observado no relatório privado. Isso é reprodução da lógica, não captura visual da sessão do usuário.
- PDF original recebido e lido localmente, com inspeção visual das páginas de compras e próximas faturas. Extração reproduziu os registros persistidos; separação manual de regiões para auditoria confirmou subtotais e explicou integralmente a diferença. Valores, contagens e descrições reais permanecem apenas no relatório privado.
- Persistem limites sobre ano original de compras sem ano, periodicidade real de serviços e valores de cada mês futuro; exigir revisão, sem inferir contratos ou datas exatas silenciosamente.
- Consulta aos logs do deployment atual não encontrou erro de execução no intervalo consultado. As falhas são de interpretação/validação, não necessariamente exceções de servidor.
- A validação anterior usou PDF fictício de uma coluna; não cobria este layout real. Ampliar fixtures de forma anonimizada antes de nova entrega.

## Ordem recomendada

1. PDF original conferido; montar amostra fictícia com as mesmas colunas, seções, sinais, encargos e diferenças de arredondamento.
2. Provar FAT-01 a FAT-06 em testes e corrigir contexto, leitura e conferência do total; revisar o catálogo depois da extração.
3. Só então planejar reversão/reimportação do lote afetado com cópia privada e autorização específica. Não ajustar ou apagar estes dados durante a auditoria.
4. Revalidar totais, faturas, parcelas, assinaturas e Análise com dados reais revisados pelo usuário, mantendo dados financeiros fora do GitHub.
