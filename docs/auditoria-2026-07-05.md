# Relatório de Auditoria — Loop Autônomo 2026-07-05

Branch: `audit/loop-2026-07-05` (base `f742453`). Metodologia: STRIDE por componente,
OWASP Top 10/ASVS, CWE Top 25, ciclo Red-Green-Refactor com prova por execução.

## Sumário executivo

| Severidade | Achados | Corrigidos | Escalados |
|---|---|---|---|
| Alto | 2 (A-01, A-03) | 2 | 0 |
| Médio | 2 (A-02, A-04) | 2 | 0 |
| Baixo | 1 (A-06) | 1 | 0 |
| Verificação limpa | 1 (A-05) | — | 0 |
| Escalados p/ decisão | 3 (E-01..E-03) | — | 3 |

Suíte antes: unit 14/14 · SQL 21/21 · tsc/lint/build/audit verdes (baseline commit 7).
Suíte depois: idêntica, sem regressão — evidências abaixo.

Contexto de cobertura: as Fases 2–3 do checklist (RLS, least privilege, injeção via
RPC parametrizada, IDOR horizontal, integridade centesimal) foram auditadas e provadas
nos commits 3–6 desta linha (Watchdog audit-verdict/1.0, registros em
`memory/state.json` namespace `auditoria`), incluindo E2E contra produção com
tentativa de INSERT direto negada por `42501`. Este loop cobriu o delta.

## Fase 1 — DFD e superfície de ataque (resumo)

Fluxo: Browser → (HTTPS) Next.js proxy (sessão) → Server Components (SELECT sob RLS)
e Browser → (HTTPS/WSS) Supabase REST/Realtime (RPCs SECURITY DEFINER, view
security_invoker). Fronteiras de confiança: (1) cliente↔Next, (2) cliente↔Supabase,
(3) Management API (deploy). Entradas externas: formulários (login, cartão,
transação), parâmetros de RPC, canal Realtime. STRIDE aplicado: Spoofing coberto por
Auth+RLS; Tampering por REVOKE de DML + RPCs; Information Disclosure era o gap
(headers/CSP — A-01); DoS parcial (tetos de parcelas/cartões; rate limit fino
escalado em E-02); Elevation coberto por SECURITY DEFINER com escopo `auth.uid()`.

## Achados

### A-01 — Ausência de Content-Security-Policy (Alto · OWASP A05 · CWE-693)
- **What:** nenhuma CSP em nenhuma rota; qualquer script externo injetado executaria.
- **Why:** CSP é a última linha contra XSS/exfiltração; sem ela, um único ponto de
  injeção futuro vira comprometimento total da sessão.
- **Where:** `next.config.ts` (headers globais).
- **When:** desde o commit 4 (headers parciais); urgência alta pré-deploy.
- **Who:** todos os usuários autenticados.
- **How:** adicionada CSP com `default-src 'self'`, `connect-src` restrito à origem
  do Supabase (https+wss, derivada de `NEXT_PUBLIC_SUPABASE_URL`), `frame-ancestors
  'none'`, `object-src 'none'`. Princípio: negar por padrão, permitir por exceção.
  Trade-off documentado: `unsafe-inline/unsafe-eval` em script-src exigidos pelo
  runtime do Next sem nonces (endurecimento = E-01).
- **How much:** 30 min.
- **Evidência:** Red `curl -sI /login | grep -ci content-security-policy` → `0`;
  Green → header presente com a política completa; smoke `/login 200`,
  `/dashboard 307`; build ok.

### A-02 — Senha mínima de 6 caracteres (Médio · OWASP A07)
- **What/Why:** política default do Supabase (6) abaixo do checklist do projeto (8);
  facilita brute force.
- **Where:** config de Auth do projeto `bqkichuwmugkjumpvrio` (plataforma, não repo).
- **How:** `PATCH /v1/projects/{ref}/config/auth {"password_min_length": 8}`.
- **Evidência:** Red `GET` → `6`; Green `GET` → `8`.

### A-03 — Confirmação de e-mail desligada em produção (Alto · OWASP A07)
- **What/Why:** `mailer_autoconfirm=true` (ligado temporariamente para o E2E de
  deploy) permitia conta ativa com e-mail de terceiro não verificado.
- **Where:** config de Auth (plataforma).
- **How:** `PATCH {"mailer_autoconfirm": false}` imediatamente após o E2E.
- **Evidência:** Red `GET` → `True`; Green `GET` → `False`.

### A-04 — SBOM inexistente (Médio · cadeia de suprimento)
- **What/Why:** sem inventário de componentes, resposta a CVE nova é cega.
- **Where:** `docs/sbom.cyclonedx.json` (novo).
- **How:** `npm sbom --sbom-format=cyclonedx` — CycloneDX 1.5, 373 componentes.
  Nota de reprodução: no Windows, dependências opcionais ausentes
  (`@emnapi/core`, `@emnapi/runtime`) exigem `npm install --no-save` prévio.
  `npm audit`: 0 vulnerabilidades; lockfile presente e íntegro (override de
  postcss ativo desde o commit 5).
- **Evidência:** Red `ls docs/sbom*` → inexistente; Green arquivo validado por parse.

### A-05 — Varredura de segredos em código e histórico (Verificação limpa)
- **What:** busca por chaves (`sbp_`, `service_role`, `eyJ…`) em todo o histórico
  (`git rev-list --all`) e por `.env.local` commitado.
- **Resultado:** `.env.local` nunca entrou no Git; únicos matches são texto de
  documentação no README. Nenhuma rotação necessária. Token de deploy do Supabase
  circulou apenas em ambiente de execução — recomendação: revogar após o deploy
  (registrado nos anexos).

### A-06 — Error boundary global ausente (Baixo · OWASP A05)
- **What/Why:** exceção não tratada caía na tela default do framework; em produção o
  Next não vaza stack, mas a experiência e o contrato de suporte (digest) ficavam
  indefinidos.
- **Where:** `src/app/error.tsx` (novo).
- **How:** boundary client-side com mensagem neutra + `error.digest` para suporte;
  nenhum detalhe interno exposto.
- **Evidência:** Red `ls src/app/error.tsx` → ausente; Green arquivo presente,
  tsc/lint/build verdes.

## Escalados (Seção 7 — decisão do dono)

- **E-01 — CSP estrita com nonces:** remover `unsafe-inline/unsafe-eval` exige
  middleware de nonce por request (mudança arquitetural no Next). Recomendo fazer
  quando houver tráfego real; risco atual mitigado pela CSP de origem.
- **E-02 — CAPTCHA e rate limits finos de Auth:** requer chave Turnstile/hCaptcha
  (conta externa) e calibragem. Recomendo Turnstile gratuito da Cloudflare.
- **E-03 — PITR/backup testado:** plano gratuito tem backup diário sem PITR;
  restauração ainda não ensaiada. Recomendo upgrade quando houver dado real
  (LGPD: dado pessoal atual = e-mail de auth apenas, minimização ok).

## Fase 11 — Verificação final

Executado nesta ordem após o último fix: unit 14/14 · tsc exit 0 · eslint exit 0 ·
`npm audit` 0 vulnerabilidades · build `Compiled successfully` · SQL suite 21/21
(Postgres real via Docker). Juiz do próprio trabalho: mudanças são aditivas
(headers, boundary, artefatos), nenhum contrato de API/schema tocado, padrão
arquitetural preservado; nenhum teste enfraquecido ou suprimido.

## Anexos

- SBOM: `docs/sbom.cyclonedx.json` (CycloneDX 1.5).
- Segredos a rotacionar: token de acesso pessoal do Supabase usado no deploy
  (`sbp_…` — revogar em supabase.com/dashboard/account/tokens); token OAuth do
  GitHub CLI (escopos repo+workflow — revogável em github.com/settings/apps).
- Pendências de plataforma fora do repo: E-01, E-02, E-03.
