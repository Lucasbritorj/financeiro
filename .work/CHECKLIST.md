# Obra — Conciliação e operação pessoal
Spec: docs/specs/conciliacao-operacao-pessoal.md.
- [x] CA1: e-mail recebido e tela correta confirmados pelo titular; senha preservada.
- [x] CA2: legado auditado; 26 registros ativos corrigidos, total original confere, sem exclusão.
- [ ] CA3: ver critério na spec.
- [ ] CA4: ver critério na spec.
- [ ] CA5: ver critério na spec.
- [ ] CA6: ver critério na spec.
- [ ] CA7: ver critério na spec.
- [ ] CA8: ver critério na spec.
- [ ] CA9: ver critério na spec.
- [ ] CA10: ver critério na spec.
- [ ] CA11: ver critério na spec.
- [ ] CA12: ver critério na spec.
- [ ] CA13: ver critério na spec.
- [ ] CA14: ver critério na spec.
- [ ] CA15: ver critério na spec.
- [ ] CA16: ver critério na spec.
- [ ] Fase 1: ver PLANO.md.
- [ ] Fase 2: ver PLANO.md.
- [ ] Fase 3: ver PLANO.md.
- [ ] Fase 4: ver PLANO.md.
- [ ] Fase 5: ver PLANO.md.
- [ ] Fase 6: ver PLANO.md.

# Correção CSP e auditoria (docs/specs/csp-e-auditoria-completa.md)
- [x] CSP CA1: nonce e política de produção; unitários e navegador real local.
- [x] CSP CA2: cookies e cabeçalhos forjados; 3 testes de componente.
- [x] CSP CA3: navegador e autenticação; desktop/celular aprovados, recuperação local e OCR conferidos.
- [x] CSP CA4: cache de HTML; decisão unitária e ativação real com limpeza de cache antigo em 2 navegadores.
- [x] CSP CA5: isolamento e concorrência SQL; 18 arquivos SQL e 4 testes concorrentes locais.
- [x] CSP CA6: relatório final entregue com limitação explícita: cobertura formal parcial por candidato SQL duplicado não consolidado; não equivale a ausência de vulnerabilidades.
- [x] CSP Fase 1: testes vermelhos e correção (csp-vermelho.log e csp-cache-vermelho.log).
- [x] CSP Fase 2: regressões e revisão; CSP aprovada localmente com ressalvas, sem novos achados nos ajustes (revisao-csp-19.md).
- [x] CSP Fase 3: auditoria após correção; 3 achados baixos, 1 corrigido localmente depois do relatório, 2 pendentes.

## Correções Pluggy/XLSX
- [x] P3 CA1: RPCs restritas no banco; permissões e chamada service_role reais em Postgres descartável.
- [x] P3 CA2: servidor valida titular e provedor; 10 testes da rota aprovados, credencial ausente falha fechada.
- [x] P3 CA3: expansão real limitada por entrada, total e quantidade, incluindo metadados falsos.
- [x] P3 CA4: ZIP/XML ambíguos, referências esparsas e nomes definidos excessivos recusados; varredura de XML malformado limitada.
- [x] P3 CA5: XLSX legítimo STORE/DEFLATE, extrato/fatura e revisão no desktop/celular preservados.
- [x] P3 Fase 1: vermelho comprovado por módulo ausente e RPC legada acessível.
- [x] P3 Fase 2: correções implementadas, migração incremental e sem dependência nova.
- [x] P3 Fase 3: 621 unitários, 173 componentes, 19 SQL, 2 E2E, build e lint sem erros; revisão independente encontrou vetor adicional tratado e testado. Gate agregado interrompido por inicialização de worker; etapa completa reexecutada e aprovada separadamente. Sem aceite remoto.
