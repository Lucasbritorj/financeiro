# Obra atual — Reserva inteligente
Spec: docs/specs/reserva-inteligente.md. Implementação autorizada por Lucas em 19/10/2026, após proposta em três etapas.
1. Motor e testes: src/lib/reserva-inteligente.ts; node --test tests/unit/reserva-inteligente.test.ts. Vermelho antes do código.
2. Preferências/RLS/RPC e consulta paginada; testes SQL apenas em Postgres17 descartável, sem rede.
3. Painel integrado a Cofrinhos, componentes e jornada local, build/lint, segurança e revisor somente leitura. Direção visual: Ateliê existente (ouro/verde/telha semânticos, títulos serifa e numerais mono), referências nos próprios cofrinhos/dashboard; sem dependências novas.
Fases sequenciais; nenhum serviço remoto ou publicação autorizado nesta etapa.

# Histórico — Conciliação e operação pessoal
Spec: docs/specs/conciliacao-operacao-pessoal.md. Execução autorizada em 17/10/2026.
1. Operação: recuperação autorizada sem trocar senha; auditoria privada do legado sem exclusão; backup/restore descartável. Dependências externas explícitas.
2. Orçamentos mensais: testes vermelhos, RPC e tela por categoria/mês, consumo por competência, zero/ausente e isolamento.
3. Contas e transferências: saldos iniciais datados, movimentos separados do consumo, atomicidade/idempotência e SQL.
4. Conciliação: staging por conta, revisão, vínculo/criação manual, saldo, fechamento/reabertura e histórico. SQL e jornada.
5. OCR: processamento local opcional, limites, progresso, revisão nos parsers existentes e PDF sintético de teste.
6. Meu Pluggy e revisão: credenciais somente servidor, vínculo ao titular, timeout/paginação, sincronização sem lançar gastos. Testes controlados, regressões, segurança e revisão independente; validação real depende do titular.
Fases sequenciais compartilham contratos; sem lote paralelo de implementação.
Histórico das obras anteriores nas specs e LOG.md.

# Correção CSP e auditoria (autorizada)
1. Testes vermelhos; política, proxy, layout e cache.
2. Unidade, navegador real, SQL efêmero/concorrência e revisão independente.
3. Executar Codex Security profundo no estado corrigido da pasta central; concluir com relatório canônico ou bloqueio exato.

## Correções Pluggy/XLSX — docs/specs/correcoes-pluggy-xlsx.md
1. Testes vermelhos de autorização SQL/rota e expansão ZIP real.
2. Migração de serviço, cliente privado e validação limitada/canônica XLSX.
3. Regressões, SQL descartável, build/lint e revisão independente somente leitura.
