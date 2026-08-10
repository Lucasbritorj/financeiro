-- 0017_endurecimento_auditoria.sql
--
-- Endurecimento defensivo derivado da auditoria de banco (Fase 1, 2026-07-22).
-- Nenhuma vulnerabilidade viva — são camadas de defesa em profundidade e
-- consistência com o padrão já adotado nas views. Idempotente (re-executável).
--
-- Cobre 3 achados:
--   #2 (MEDIUM) revoga SELECT de `anon` nas 11 tabelas de base (a RLS já barra
--       `anon` porque auth.uid() é NULL, mas as views usam só `authenticated` —
--       aqui alinhamos as tabelas ao mesmo mínimo privilégio).
--   #5 (LOW)    remove as policies de INSERT/UPDATE "mortas" das 4 tabelas
--       núcleo (inertes desde 0005, que revogou o DML de tabela; se um GRANT
--       fosse reconcedido por engano elas reviveriam silenciosamente).
--   #4 (MEDIUM) adiciona teto superior às colunas monetárias, fechando a janela
--       teórica de perda de precisão na borda JS (bigint tipado como `number`;
--       Number.MAX_SAFE_INTEGER ~ 9,007e15 centavos). Teto folgado para uso
--       pessoal: 999999999999 centavos = R$ 9.999.999.999,99.
--
-- NÃO cobre (follow-up documentado):
--   #7 (LOW) validação do cast jsonb->bigint em criar_importacao/0009+0016
--       (hoje falha com erro cru do Postgres em vez de FW400+hint). Exige
--       reescrever o corpo da função; fica para 0018 junto de novos formatos.

-- ---------------------------------------------------------------------------
-- #2 — Revoga SELECT de `anon` nas 11 tabelas de base (mantém `authenticated`).
-- ---------------------------------------------------------------------------
revoke select on public.cartoes_credito       from anon;
revoke select on public.faturas               from anon;
revoke select on public.transacoes_origem     from anon;
revoke select on public.parcelas              from anon;
revoke select on public.categorias            from anon;
revoke select on public.regras_categorizacao  from anon;
revoke select on public.importacoes           from anon;
revoke select on public.importacao_linhas     from anon;
revoke select on public.cofrinhos             from anon;
revoke select on public.movimentacoes_cofrinho from anon;
revoke select on public.recorrencias          from anon;

-- ---------------------------------------------------------------------------
-- #5 — Remove policies de INSERT/UPDATE mortas das 4 tabelas núcleo. O DML
--      direto já está revogado (0005); a leitura (SELECT) e a ausência de
--      DELETE físico permanecem intactas. As tabelas criadas depois (0008+)
--      já seguem este padrão (sem policy de insert/update, só default-deny).
-- ---------------------------------------------------------------------------
drop policy if exists cartoes_insert    on public.cartoes_credito;
drop policy if exists cartoes_update    on public.cartoes_credito;
drop policy if exists faturas_insert    on public.faturas;
drop policy if exists faturas_update    on public.faturas;
drop policy if exists transacoes_insert on public.transacoes_origem;
drop policy if exists transacoes_update on public.transacoes_origem;
drop policy if exists parcelas_insert   on public.parcelas;
drop policy if exists parcelas_update   on public.parcelas;

-- ---------------------------------------------------------------------------
-- #4 — Teto superior nas colunas monetárias persistidas (centavos bigint).
--      drop-then-add torna a migration re-executável.
-- ---------------------------------------------------------------------------
alter table public.cartoes_credito   drop constraint if exists cartoes_limite_total_teto;
alter table public.cartoes_credito   add  constraint cartoes_limite_total_teto
  check (limite_total <= 999999999999);

alter table public.transacoes_origem drop constraint if exists transacoes_valor_total_teto;
alter table public.transacoes_origem add  constraint transacoes_valor_total_teto
  check (valor_total <= 999999999999);

alter table public.parcelas          drop constraint if exists parcelas_valor_teto;
alter table public.parcelas          add  constraint parcelas_valor_teto
  check (valor <= 999999999999);

alter table public.categorias        drop constraint if exists categorias_orcamento_teto;
alter table public.categorias        add  constraint categorias_orcamento_teto
  check (orcamento_mensal is null or orcamento_mensal <= 999999999999);

alter table public.cofrinhos         drop constraint if exists cofrinhos_saldo_teto;
alter table public.cofrinhos         add  constraint cofrinhos_saldo_teto
  check (saldo_atual <= 999999999999);
