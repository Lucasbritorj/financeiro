# Correção da importação Itaú — 17/10/2026

Status: migração instalada e correções publicadas em 17/10/2026 após autorização explícita. Recuperação do lote antigo permanece uma operação separada.
Spec: [corrigir-fatura-itau](specs/corrigir-fatura-itau.md). Auditoria sanitizada: [achados](auditorias/importacao-faturas-itau-2026-10-17.md).

## Comportamento

- A tela exige escolher extrato ou fatura. PDF identificado como fatura é recusado no extrato antes de enviar linhas ao servidor.
- O leitor separa tabelas pelos cabeçalhos, mantém pagamentos e próximas parcelas como informativos e ignora ofertas/limites. Câmbio não substitui o valor cobrado em reais; IOF é uma cobrança separada e revisável.
- Valores futuros explicitamente correspondentes alimentam a estimativa do plano. Não são lançamentos de despesas; ambiguidades não recebem vínculo automático.
- Ano/data sugeridos exigem conferência. Serviços conhecidos são sugestões de assinatura, nunca contratos automáticos.
- Total extraído do PDF fica imutável. Divergência bloqueia a confirmação mesmo quando uma conferência foi marcada; valores e seleção devem ser corrigidos.
- Painel e Análise usam movimentos à vista por data e cartão por competência/valor da cobrança, sem somar a compra original e sem incluir estimativas. Análise permite navegar entre meses e não conclui equilíbrio pela ausência de alertas.

## Prova

| Afirmação | Evidência |
|---|---|
| Erros reproduzidos antes da correção | 7 falhas de domínio, 3 de componente e SQL rejeitado pelo assert de previsão ausente; nova regressão do total mutável também falhou antes do ajuste |
| Domínio e proteção estática | 584 unitários aprovados |
| Interface e bloqueios | 156 testes de componentes aprovados |
| Persistência e isolamento | SQL local com 14 arquivos; novo arquivo com 16 asserts; upgrade de 35 migrações e teste real de concorrência aprovados |
| Jornada autenticada | 26 jornadas da rodada completa aprovadas; caso novo falhou por semântica do aviso, corrigido; reexecução final das 6 jornadas afetadas aprovada em celular e desktop |
| Interface real | Screenshots em 320/375/768/1024/1440/1920 nos dois temas; sem overflow; axe sem violações, teclado e reduced-motion exercitados |
| Compilação | Next build e TypeScript aprovados no build usado na jornada final |
| Lint | Zero erros; 20 avisos sobre complexidade e organização do código, sem desativar regras |
| Performance | Lighthouse na rota autenticada: desempenho 100, acessibilidade 100, LCP 0,3 s, CLS zero |
| Segurança | Auditoria de dependências de produção sem vulnerabilidades; gitleaks no histórico (184 commits) e alterações sem vazamentos |
| Revisão independente | Somente leitura, aprovada após fechar a brecha do total editável; nenhum achado acionável pendente |

O PDF particular foi conferido somente localmente, com total, previsão e classificações reconciliados sem linhas descartadas. Arquivo, imagens, valores reais e extrações permanecem fora do Git.

## Instalação e retorno

Aplicar apenas a migração aditiva `20261017150000_corrigir_fatura_itau.sql` ao ambiente confirmado antes de publicar o código que consulta `vw_movimentos_competencia`. A migração substitui a RPC de confirmação e cria uma view invoker; não reescreve dados existentes.

Etapa executada: simulação confirmou somente essa migração; cópia privada das 14 tabelas financeiras e definições anteriores preservada. Instalação terminou com saída zero; contagens e hashes permaneceram idênticos. A view invoker, RLS e permissões da RPC foram conferidos por leitura; nenhuma migração pendente.

[PR #14](https://github.com/Lucasbritorj/financeiro/pull/14) integrado em `37993b3`, após seis verificações aprovadas e prévia testada. CI pós-merge [39055544238](https://github.com/Lucasbritorj/financeiro/actions/runs/39055544238) aprovado. [Aplicativo publicado](https://financeiro-brito-s.vercel.app), versão [imutável](https://financeiro-1ppumyrxs-brito-s.vercel.app), READY e domínio confirmado nessa versão. Sete verificações HTTP, login e recuperação no navegador aprovados, zero pageerror; nenhuma chamada de gravação de teste em produção. Consulta de erros dessa publicação sem ocorrências no intervalo consultado.

Retorno disponível pelo deployment anterior `financeiro-7zzr3yvyo-brito-s.vercel.app`. Arquivos privados, PDF e credenciais não entraram no GitHub; varredura dos 186 commits sem vazamentos e revisão dos 34 arquivos do envio sem dados reais da fatura.

Preparar cópia privada e conferir migrações/permissões antes de qualquer instalação remota. Retorno de código pode usar o deployment anterior: a RPC preserva a assinatura existente e aceita o payload antigo; a view adicional pode permanecer. Não desfazer dados de importações confirmadas automaticamente.

O lote já importado incorretamente permanece preservado. Sua reversão/reimportação requer uma operação específica revisada, com conferência de assinaturas/datas e proteção contra duplicidade; publicar a correção não altera esse lote.

Limites: OCR, PDFs protegidos e garantia universal de layouts continuam fora do escopo. Datas sem ano e periodicidade dos serviços precisam de confirmação; valores de meses futuros não detalhados são estimativas.
