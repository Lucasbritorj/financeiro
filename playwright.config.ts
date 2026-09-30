import { defineConfig, devices } from "@playwright/test";

// E2E de navegador. Existe porque `rules/ecc/web/testing.md` exige regressão
// visual por breakpoint, checagem automática de a11y, contraste e teclado — e
// até 09/09/2026 o projeto não tinha uma única asserção de navegador.
//
// Caminho mínimo ponta-a-ponta primeiro (1 rota pública, 2 breakpoints, axe),
// como manda o CLAUDE.md. Expandir depois: rotas protegidas exigem sessão
// Supabase real e entram só quando houver usuário de teste dedicado.
//
// Porta 3100 e não 3000: o dev server local costuma ocupar a 3000, e um
// `reuseExistingServer` apontado para o dev server testaria build de dev.
const PORT = Number(process.env.E2E_PORT ?? 3100);
const baseURL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [["github"], ["list"]] : [["list"]],
  use: {
    baseURL,
    trace: "on-first-retry",
    // Determinístico: sem espera por timeout, só por estado.
    actionTimeout: 10_000,
  },
  // Os 4 breakpoints que `rules/ecc/web/testing.md` exige. Começou em 320+1440
  // (caminho mínimo, 09/09); 768 e 1024 entraram em 10/09 porque são exatamente
  // onde o layout troca de coluna — o intervalo que 320 e 1440 não cobrem.
  projects: [
    {
      name: "mobile-320",
      use: { ...devices["Desktop Chrome"], viewport: { width: 320, height: 640 } },
    },
    {
      name: "tablet-768",
      use: { ...devices["Desktop Chrome"], viewport: { width: 768, height: 1024 } },
    },
    {
      name: "laptop-1024",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1024, height: 768 } },
    },
    {
      name: "desktop-1440",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
    },
  ],
  webServer: {
    // `next start` exige build feito: o script test:e2e roda build antes.
    // E2E_DEV=1 troca para o dev server — serve para rodar a suíte enquanto o
    // `tsc` do build está vermelho por trabalho em andamento em outro arquivo.
    // CI nunca usa esse caminho: lá o build tem de passar.
    command: process.env.E2E_DEV
      ? `npm run dev -- --port ${PORT}`
      : `npm run start -- --port ${PORT}`,
    url: baseURL,
    timeout: 120_000,
    reuseExistingServer: !process.env.CI,
    env: {
      // O build/serve não conecta no Supabase nas rotas públicas;
      // placeholders satisfazem o createClient, igual ao job `node` do CI.
      NEXT_PUBLIC_SUPABASE_URL:
        process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://placeholder.supabase.co",
      NEXT_PUBLIC_SUPABASE_ANON_KEY:
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "placeholder",
    },
  },
});
