# Correção CSP e auditoria — 19/10/2026

A política de execução de scripts foi restringida e validada em produção local, no desktop e no celular. Cada resposta HTML recebe autorização aleatória para seus scripts. Scripts sem autorização e eval JavaScript são bloqueados; tema, autenticação, navegação e OCR continuam funcionando. HTML privado não é guardado pelo PWA; a ativação remove o cache antigo. WebAssembly permanece permitido para OCR, e estilos inline por compatibilidade.

## Provas locais

| Verificação | Resultado |
|---|---|
| Unitários | 612 aprovados |
| Componente do proxy | 3 aprovados |
| Build isolado de produção | compilação e geração de 24 rotas aprovadas |
| Lint geral | 0 erros, 30 avisos |
| Navegador CSP, login e OCR | 2 aprovados, desktop e celular |
| Limpeza de cache antigo no navegador | 2 aprovados, teste suplementar local |
| Conciliação de contas | 2 aprovados, desktop e celular |
| SQL em Postgres descartável | 18/18 arquivos aprovados |
| Concorrência SQL | 4 aprovados |

A execução autenticada inicial teve 31/34 aprovados. As três falhas eram a interação do teste com o menu móvel e o schema local desatualizado; os casos afetados foram reexecutados e aprovados. A suíte inteira não foi repetida depois desses ajustes. Nenhum teste financeiro foi executado em produção.

A revisão independente aprovou a CSP no escopo local, com ressalvas de cobertura, sem novos achados nos ajustes finais. O teste de cache comprovou a limpeza na ativação; não reproduziu uma atualização com a versão anterior do service worker já instalada.

## Resultado da auditoria

O relatório canônico do Codex Security Standard foi gerado e selado. Foram revisados 382 arquivos; três inventários gerados/binários foram excluídos da leitura de código. A cobertura formal permaneceu **parcial**, pois a consolidação reteve um candidato SQL duplicado como pendência. Não equivale a certificação de ausência de vulnerabilidades. A medição de tokens não ficou disponível.

Foram validados três achados de baixa severidade:

- **Pendente: reserva indevida de vínculo Pluggy.** A função pública permite informar identificadores externos sem comprovar sua titularidade. Sob condições específicas, alguém autenticado que já conheça o identificador de outra conta pode impedir seu primeiro vínculo. Não foi demonstrado acesso a dados bancários. Recomenda-se restringir o vínculo ao servidor após validar o provedor e o titular.
- **Pendente: planilhas XLSX sem limite de descompactação.** O limite do arquivo comprimido não limita sua expansão em memória. Uma planilha maliciosa pode travar a aba de quem a importar. Recomenda-se limitar entradas e tamanho expandido antes de materializar o conteúdo.
- **Corrigido localmente após a selagem: agregado financeiro em log versionado.** A informação foi substituída por registro qualitativo, sem valores, contagens ou período financeiro. O relatório preserva o estado observado durante a auditoria; não foi comprovada publicação da informação.

A auditoria de dependências não encontrou alertas de produção. Nas ferramentas de desenvolvimento existem 23 alertas: 1 crítico, 17 altos, 3 moderados e 2 baixos. Não foi aplicada atualização forçada: algumas sugestões alteram versões principais ou propõem retrocessos. O histórico de 194 commits não apresentou segredos no Gitleaks.

Os registros de execução estão em `.work/csp-20261018-*` e `.work/csp-20261019-*`. O relatório canônico permanece nos artefatos privados do Codex Security. Esta etapa não incluiu commit, push, migração remota ou publicação.

## Correções posteriores dos dois achados de produto

Os pontos acima identificados como pendentes foram corrigidos e testados localmente em uma etapa posterior: ver [especificação das correções](specs/correcoes-pluggy-xlsx.md). O vínculo agora exige validação do servidor e RPC exclusiva de serviço; XLSX tem expansão real limitada, ZIP canônico e proteção de referências/nomes definidos. Provas finais: 621 unitários, 173 componentes, 19 arquivos SQL e 2 testes de navegador aprovados, build aprovado e lint sem erros. O gate agregado parou na inicialização de um worker; a etapa completa de componentes passou ao ser repetida separadamente. A migração e a configuração privada de servidor ainda não foram instaladas no ambiente publicado. O relatório selado não foi alterado nem recertificado.
