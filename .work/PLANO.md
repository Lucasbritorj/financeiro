# Obra atual — Correções da auditoria de segurança
Spec: docs/specs/correcoes-auditoria-seguranca.md. Plano aprovado em21/10/2026.
Estado: duas migrações instaladas, configuração privada e TLS conferidos, aplicação publicada e verificada remotamente; dados anteriores preservados. Backup automático local instalado e executado. CA2 (3 dependências dev sem versão corrigida) e CA9/Fase4 (Hostinger e alertas) permanecem pendentes. Procedimento e limites em docs/seguranca-operacao.md.
1. Inventário/compatibilidade: preservar worktree antigo, confirmar docs Next e testes, atualizar dependências vulneráveis com consulta atual.
2. Fronteira de sessão: cookies/rotas de autenticação e dados, origem/inputs, logout e recuperação; testes vermelhos antes do código.
3. Limites persistentes e diagnóstico seguro: migração incremental, Pluggy/exportação, mensagens e eventos; SQL somente Postgres17 descartável.
4. Backup criptografado/rotina e integração externa privada disponível; teste de adulteração/restauração e agendamento sem sobreposição.
5. Regressões, segurança e revisão independente, provas e limites de operação/publicação. Fases sequenciais por contratos compartilhados.

# Histórico — Previsão, reservas e regras pessoais
Spec: docs/specs/previsao-reservas-e-regras-pessoais.md. Fases1–4 validadas e entrega autorizada em20/10/2026: uma migração instalada após backup restaurado,GitHub/CI aprovados e fonte2b8994b publicada. Entregas anteriores preservadas. Provas no LOG; sem merge em master.
1. Motor de projeção90dias: testar antes receita prevista/recebida/pulada, menor saldo antes do salário, vencimentos, própria transferência e compra/fatura sem duplicação. Reusar src/lib/planejamento-consulta.ts e fontes de receitas/contas existentes; adicionar domínio e testes dirigidos, sem escrita financeira. Verificação: node --test tests/unit/<novos-testes>.test.ts e invariantes dependentes.
2. Planejamento/Cofrinhos: reusar reserva-inteligente/reserva-consulta e coberturaMes. Carregar base/compromissos conhecidos para revisão, mostrar incompletude e motivo de distribuição por meta; conservar controles de simulação. Ler docs Next e skill design-system antes de TSX; componentes e browser local com conta sintética, sem banco remoto.
3. Regras: partir de lista-transacoes/use-lista.ts e definir_categoria_transacao existente; padrão editável, exemplos paginados, conflitos e gravação atômica/repetível. Testes SQL primeiro em Postgres17 descartável e RLS, testes de componente/rede e jornada atual→regra→novo lançamento. Nunca reclassificar histórico em massa implicitamente.
4. Lint/build/unidade/componentes/SQL, navegador real, axe/teclado/seis larguras/dois temas/Lighthouse, segurança e revisão independente. Fases sequenciais por fontes financeiras/arquivos compartilhados; nenhum agente paralelo de implementação necessário. Instalação/push/publicação fora deste plano até autorização de entrega.

# Histórico publicado — Receitas recorrentes com confirmação
Spec: docs/specs/receitas-recorrentes-confirmadas.md. Plano e instalação/publicação aprovados por Lucas em20/10/2026; migrações instaladas e versão006e5f9 publicada. Provas locais/remotas e backup restaurado registrados em LOG.
1. Confirmar modo de recebimento com titular; criar testes vermelhos de calendário (inclusive fevereiro), ocorrências e operações repetidas. Alvos previstos: tests/unit/receitas-recorrentes.test.ts e supabase/tests/verificacao_receitas_recorrentes.sql.
2. Implementar uma migração incremental após20261020120000: reaproveitar recorrencias, adicionar partes/ocorrências privadas e RPCs atômicas para confirmar individual/em conjunto, pular e desfazer. Integrar aplicar_recorrencias sem quebrar despesas/assinaturas. Validar somente com Postgres17 descartável e SQL completo, além de concorrência de confirmação.
3. Integrar NovaTransacaoForm, Recorrencias e tipos de banco; confirmação humana e estados claros. Consultar docs Next locais e skill design-system antes de TSX; testes de componentes e navegador com conta sintética, duas datas, férias e antecipação.
4. Gates locais, segurança, screenshots, revisão independente pela skill revisar e LOG/checklist. Sem migração remota/push/publicação nesta etapa. Fases sequenciais pois compartilham contratos/arquivos.

# Histórico local validado, ainda não publicado — Receitas no caixa
Spec: docs/specs/receitas-no-caixa.md.
1. Componentes vermelhos: tipo primeiro, receita sem campos de crédito e limpeza de categorias; preservar testes de despesas.
2. Receita autenticada/atômica, forma TRANSFERENCIA, observação e lista/filtros; SQL apenas em Postgres17 descartável, sem rede.
3. Testes dependentes, build/lint/segurança e revisão independente. Não publicar nem migrar remoto nesta implementação.
Vínculo direto à conta bancária aguarda resposta; etapas acima não gravam movimentos_conta.

# Histórico — Reserva inteligente
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
