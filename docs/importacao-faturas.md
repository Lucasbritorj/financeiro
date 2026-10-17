# Importação e revisão de faturas de cartão

Implementação da spec `docs/specs/importar-faturas-cartao.md`. A primeira versão usou PDF textual fictício. O documento particular foi conferido privadamente na rodada de correção, já publicada em 17/10/2026: [correção da fatura Itaú](correcao-fatura-itau.md). A leitura é por layout, sem garantia universal para qualquer PDF bancário.

## Fluxo

Em Importar, escolher Fatura de cartão, cartão cadastrado e mês. O arquivo é lido no navegador e a revisão ainda não grava despesas. CSV, OFX/OFC, XLSX e PDF compartilham a revisão; o fluxo de Extrato bancário permanece separado.

Cada linha mantém evidência original e permite corrigir descrição, data, valor, categoria, tipo, número/total de parcelas e vínculos. Possíveis assinaturas exigem decisão: criar contrato com periodicidade/próxima cobrança, vincular a contrato ativo desse cartão ou tratar somente como gasto. Duas ocorrências mensais anteriores podem sugerir recorrência, sem comprovar contrato.

## Dinheiro e repetição

- Cobrança efetiva entra como despesa de crédito e parcela única na competência confirmada. Não usa débito nem inventa parcelas anteriores.
- Planos de parcelamento guardam metadados; futuras são calculadas em `vw_previsoes_parcelamento`, fora dos totais efetivos. A tela oferece consulta e edição do valor previsto sem alterar cobranças confirmadas.
- Importar a parcela seguinte exige vínculo explícito ao plano. Mês/número/total incompatíveis são recusados. Compras de mesmo nome/valor podem ser diferentes; o servidor exige revisão de semelhanças, inclusive com parcelas manuais preexistentes.
- Arquivo por conta/cartão/mês e chave de confirmação impedem duplicação por repetição/rede. Identificador externo tem precedência. Compra legítima igual pode ser confirmada explicitamente como nova; sem essa decisão, repetição exata é ignorada.
- Uma transação no banco grava lote, despesa, parcela, plano e vínculo de contrato. Qualquer erro reverte o lote. Trava por usuário coordena com criação/edição de assinatura e exclusão de cartão.

## Limites explícitos

- Créditos e estornos não viram receitas nem compras: exigem exclusão explícita. Diferenças de total e linhas descartadas exigem conferência. Suporte contábil completo a ajustes fica para uma etapa própria.
- CSV/XLSX preservam marcadores D/C, sufixos e colunas de crédito/débito. Quando o significado do sinal não é inequívoco no layout, cada linha exige confirmação de que é despesa.
- Pagamentos, saldos e totais são destacados; juros são despesas revisáveis. PDF sem texto/senha não é tratado por OCR. Seções identificadas de cartões diferentes são bloqueadas; outros layouts incompletos podem exigir separação ou formato alternativo.
- Até 10 MB e 1000 linhas por lote. Dados originais de faturas, credenciais, logs e sessões ficam fora do GitHub público; fixtures são fictícias.

## Instalação e retorno

Nova migração: `20261017130000_importar_faturas_cartao.sql`, aditiva após as 33 anteriores. Cria três tabelas com RLS e leitura autenticada, uma view invoker e duas funções com escrita controlada. Não modifica as funções de confirmação de extrato existentes.

**Instalada e publicada em 17/10/2026 após autorização explícita do Lucas.** A simulação identificou somente `20261017130000_importar_faturas_cartao.sql`; instalação terminou com saída zero, sem seeds, roles ou Vault. Cópia privada dos registros das 11 tabelas financeiras e definições das funções anteriores em `C:\Backup\financeiro-web\importacao-faturas` (não equivale a backup integral do Supabase/Auth).

Conferência posterior somente de leitura: migração registrada, três tabelas com RLS/leitura autenticada/escrita direta revogada, view invoker e duas funções definer com search_path vazio, execução autenticada e vedada a anon. Contagens/hashes das 11 tabelas existentes permaneceram idênticos; nenhuma linha criada pela instalação. Simulação final sem migrações pendentes.

[PR #13](https://github.com/Lucasbritorj/financeiro/pull/13) integrado à master em `7666835`. Vercel produção `dpl_EfBigTQ7LBUgQ8eSjLSK55PbtN6u` READY, versão imutável `https://financeiro-7zzr3yvyo-brito-s.vercel.app`, domínio principal `https://financeiro-brito-s.vercel.app`. Sete verificações HTTP de acesso/proteção aprovadas; jornadas com gravação continuam comprovadas no ambiente local, sem dados de teste em produção.

Retorno de frontend: versão anterior `https://financeiro-8k0vshpv9-brito-s.vercel.app`. Não apagar tabelas, funções ou dados para desfazer a interface nem reescrever histórico de migrações automaticamente.

## Provas da implementação

Provas completas por fase ficam em `.work/LOG.md`; capturas e relatórios gerados permanecem ignorados. Regressões iniciais mostraram módulo/RPC ausentes; revisão encontrou e testou crédito CSV, parcela manual duplicada, PDF com dois cartões e compra legítima igual marcada NOVA. Testes com gravação usaram somente instância local; a instalação/publicação remota posterior teve autorização específica.
