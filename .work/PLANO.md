# Obra atual — Planejamento e importação segura
Spec: docs/specs/planejamento-e-importacao-segura.md. Pedido de execução autoriza o plano; padrões de comportamento registrados na spec.

1. Datas e domínio de planejamento/alertas. Criar testes unitários dos CA1–CA4/CA8–CA9, comprovar vermelho, implementar regras puras e revisão de datas. Verificar testes pontuais e componentes de importação.
2. Reversão segura. Primeiro asserts SQL CA5–CA7; migração aditiva com vínculo de novos extratos, histórico e RPC de prévia/reversão, sem executar no remoto. Tipos e interface de histórico na importação. Verificar SQL efêmero, upgrade e concorrência.
3. Planejamento e alertas na interface. Reaproveitar tokens Ateliê, leituras completas e estados de erro. Página Planejamento com meses/cartões, alertas e acesso pelo Dashboard. Verificar jornada real local, teclado, axe, screenshots nos seis tamanhos/dois temas e Lighthouse autenticado.
4. CI e entrega. Job Supabase local para todas as jornadas autenticadas em desktop/celular; sem credenciais externas. Rodar testes dependentes, build/lint, segurança e revisão independente. Registrar provas e instalação necessária. Não alterar dados financeiros reais.

Fases sequenciais: domínio e persistência são contratos usados pela interface e pelos testes. Não há lote paralelo de implementação.

Histórico anterior: correção Itaú e manutenção de enquadramento entregues; provas em LOG.md e docs/correcao-fatura-itau.md.
