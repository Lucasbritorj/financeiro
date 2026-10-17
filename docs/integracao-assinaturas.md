# Central de Assinaturas — integração em 17/10/2026

## Origem e comportamento

Integra os commits `8a9d5d1` (central de 07/10) e `d4c6285` (complementos de 11/10) de `origin/wip/consolidacao-20261011`, preservando as correções da entrega de 16/10. A auditoria de dependências do CI foi incorporada também ao gate local; a branch de correção de CI não foi mesclada integralmente.

A rota `/assinaturas`, o menu e a busca por comandos oferecem cadastro/edição, cartão/categoria opcionais, periodicidade mensal/trimestral/semestral/anual e estados ativa/pausada/cancelada. Resumos mostram custo mensal equivalente, projeção anual, próximas cobranças e impacto por cartão.

Assinaturas avançam somente a agenda: não criam despesas, faturas ou cobranças no fornecedor. Cancelar no Ateliê registra o controle; o usuário precisa cancelar o contrato no fornecedor. As recorrências normais continuam criando lançamentos quando o motor roda.

## Correções da integração

- Filtrar datas futuras antes de limitar próximas cobranças.
- Paginar por último ID antes de apresentar totais; erro em qualquer página não apresenta resultado parcial.
- Informar erros de consulta e rede, oferecer nova tentativa e liberar envios no `finally`.
- Não repetir o motor 24 vezes quando uma ocorrência falha.
- Serializar criação/edição de assinatura e exclusão de cartão por usuário antes das travas de linha, evitando vínculo com cartão excluído.
- Isolar edição de recorrência comum por finalidade e validar teto antes da gravação.
- Preservar a navegação sem overflow com o novo item Assinaturas.

## Provas obtidas

| Critério | Evidência | Resultado |
|---|---|---|
| CA1: integrar e preservar entregas | Unitários de comandos/contratos, gate e jornadas anteriores | Passou |
| CA2: custos e próximas cobranças | Unitários de assinaturas e regressão com seis cobranças vencidas antes de uma futura | Passou |
| CA3: persistência, isolamento e rede | Componentes, asserts SQL e jornada autenticada real | Passou |
| CA4: agenda sem despesa duplicada e ordem de atualização | SQL 12/12; upgrade com 33 migrações e 12 arquivos de asserts; concorrência reproduzida antes e corrigida depois | Passou |
| CA5: navegador e interface | 22 jornadas anteriores + 2 novas em desktop/celular, persistência e ausência de despesas/faturas; axe sem violações; teclado; capturas 320/375/768/1024/1440/1920 em ambos os temas | Passou |
| CA6: entrega | 559 unitários, 147 componentes, tipos/lint/build; auditoria de produção zero; gitleaks sem vazamentos; revisão independente aprovada | Passou |

Lighthouse na rota autenticada, com Supabase local e conta temporária: desempenho **77**, acessibilidade **100**, LCP **2,5 s**, CLS **0**. Medição local única, sem promessa sobre produção. Lint mantém 14 avisos de tamanho/complexidade (12 anteriores e 2 da central); zero erros. O gate não equivale ao CI remoto completo: não reinstala as dependências e não executa as ações hospedadas do GitHub.

Os 22 testes anteriores passaram na primeira execução. Os dois novos falharam por seletor de teste de cartão; o seletor foi ajustado para o papel acessível `combobox` e os dois passaram. Não foi necessário repetir as jornadas anteriores sem alteração funcional relevante.

## Instalação remota realizada em 17/10/2026

Após autorização explícita do Lucas, as três migrações foram instaladas no projeto `bqkichuwmugkjumpvrio`. O site de produção continua na versão de 16/10, sem a interface da Central de Assinaturas. O [PR #12](https://github.com/Lucasbritorj/financeiro/pull/12) permanece em rascunho, sem merge na master. Instalar o banco não publica o aplicativo.

Arquivos instalados:

1. `20261006120000_central_assinaturas.sql`.
2. `20261007120000_corrigir_central_assinaturas.sql`.
3. `20261016210000_integrar_assinaturas_cadastros.sql`.

O preflight imediatamente anterior à instalação confirmou o alvo e **zero** valores acima do teto, usando a consulta abaixo. Nenhum valor foi reduzido automaticamente.

```sql
begin read only;
select count(*) as recorrencias_acima_do_teto
from public.recorrencias where valor > 999999999999;
commit;
```

Como duas migrações são anteriores à última já instalada, a aplicação usou `supabase db push --linked --include-all --skip-vault --yes`, com saída zero. O teste de upgrade local já havia reproduzido essa ordem. Não houve alteração de seeds, roles ou Vault nem reescrita do histórico remoto.

Antes da instalação, foram preservadas definições e permissões das cinco funções existentes, registros e estrutura das recorrências, em cópia privada em `C:\Backup\financeiro-web\assinaturas`. É uma cópia direcionada, não um backup integral do banco.

Conferência posterior somente de leitura: três versões registradas, cinco colunas esperadas, nove funções, isolamento por RLS e permissões corretas. Contagens e hashes dos sete conjuntos financeiros permaneceram idênticos; a quantidade de recorrências foi preservada. A simulação final retornou `upToDate: true` e nenhuma migração pendente. Não foram criados registros de teste em produção.

Ainda faltam integrar o PR e publicar/conferir a interface em produção, mediante autorização específica. O rollback de frontend não desfaz automaticamente as funções novas no banco.
