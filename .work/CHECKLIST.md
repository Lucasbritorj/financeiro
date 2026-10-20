# Obra atual — Receitas recorrentes com confirmação
Spec: docs/specs/receitas-recorrentes-confirmadas.md. Aprovada em20/10/2026; aceite local, ainda não instalado/publicado.
- [x] CA1: várias partes mensais e formulário orientado por tipo; componentes e navegador.
- [x] CA2: último dia do mês sem perder dia contratado; unidade, SQL e fevereiro bissexto no navegador.
- [x] CA3: confirmação do recebimento antes do caixa; SQL e saldo0→30000.
- [x] CA4: pular só uma ocorrência e desfazer marcação; SQL/componentes/navegador.
- [x] CA5: receber antecipado/em conjunto sem duplicar; uma transação e duas ocorrências.
- [x] CA6: desfazer recebimento respeitando bloqueios existentes; grupo, conciliação e período fechado em SQL real.
- [x] CA7: repetição, concorrência e isolamento por titular; três corridas reais e RLS.
- [x] CA8: histórico/início preservados e contratos anteriores mantidos; SQL completo22arquivos e regressão de pausa/edição.
- [x] CA9: estados, falhas e interface responsiva/acessível; componente de rede, axe, teclado, dois temas/seis larguras e Lighthouse82/100.
- [x] Fase1: decisão aprovada e testes vermelhos por módulo/RPC ausentes.
- [x] Fase2: persistência e regras SQL apenas locais.
- [x] Fase3: integração de interface, sem dependências novas.
- [x] Fase4: verificações e segunda revisão independente aprovada.

# Histórico local validado, ainda não publicado — Receitas no caixa (docs/specs/receitas-no-caixa.md)
- [x] CA1: formulário orientado por tipo; componentes e navegador real.
- [x] CA2: receita normal sem crédito/parcelamento; domínio, SQL e navegador.
- [x] CA3: transferência externa reconhecida em cadastro/lista/filtro/edição/conciliação; SQL de vínculo real.
- [x] CA4: escrita atômica e repetição segura, inclusive após substituir; SQL.
- [x] CA5: sinais e regimes de caixa preservados; SQL completo e navegador.
- [x] CA6: isolamento, limites e erros explícitos; SQL/componentes e nota literal no navegador.
- [x] CA7: regressões e interface responsiva; gate, quatro larguras/dois temas, axe e teclado.
- [x] Fase 1: vermelho de domínio/SQL antes da implementação; formulário.
- [x] Fase 2: banco e integração, somente local.
- [x] Fase 3: validações e segunda revisão independente aprovada.

# Histórico — Reserva inteligente (docs/specs/reserva-inteligente.md)
- [x] Instalação autorizada20/10: backup restaurado54tabelas e migração remota conferida, dados anteriores preservados.
- [x] Publicação autorizada20/10: Preview desktop/celular, CI integral aprovado, produção READY e domínio principal com painel autenticado HTTP200.
- [x] CA1: preferências privadas, substituição idempotente e sem aportes; SQL + E2E.
- [x] CA2: cobertura dos três meses anteriores, sem inventar completude; domínio + consulta com erro explícito.
- [x] CA3: consumo sem duplicação e bases conservadoras; domínio + regressões SQL existentes.
- [x] CA4: limites de caixa/mês/intenção e dinheiro em centavos; domínio + E2E com 1.003 aportes arquivados.
- [x] CA5: distribuição determinística limitada aos alvos; domínio.
- [x] CA6: simulação distinta de estimativa e confirmação humana; componentes + E2E.
- [x] CA7: formulário, persistência e explicações; componentes + E2E.
- [x] CA8: falhas explícitas e interface acessível/responsiva; componentes, axe, seis larguras/dois temas e Lighthouse autenticado.
- [x] Fase 1: vermelho e domínio.
- [x] Fase 2: SQL/consulta.
- [x] Fase 3: interface, validação e revisão; segunda rodada independente aprovada.

# Histórico — Conciliação e operação pessoal (itens não recertificados por esta obra)
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

## Publicação autorizada em 19/10/2026
- [x] Backup privado com restauração conferida antes da instalação.
- [x] Quatro migrações remotas aplicadas atomicamente, dados anteriores e permissões conferidos.
- [x] Credencial privada de serviço configurada como segredo somente em Production.
- [x] Fonte 0be645b no GitHub com CI integralmente aprovado: 622 unitários, 173 componentes e 44 jornadas autenticadas, além de SQL/build/lint/tipagem/interface.
- [x] Preview validada com conta fictícia, desktop/celular, sem confirmar lançamentos; contas de teste removidas.
- [x] Produção READY, alias principal verificado e checagem HTTP autenticada aprovada; proteção Vercel preservada. Navegador completo de produção continua condicionado à sessão Vercel, conforme LOG.
- [x] PR17 aberto; nenhuma alteração direta ou merge em master.
