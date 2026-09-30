import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

// /login é a única rota pública com formulário: é onde a11y de formulário
// (rótulo, foco, contraste) pode ser provada sem sessão Supabase.
//
// Regra de severidade: falha só em `critical` e `serious`. `moderate`/`minor`
// entram como aviso no relatório — subir a barra depois que o verde for
// estável, nunca antes, senão o gate nasce vermelho e é desligado.
const GRAVES = new Set(["critical", "serious"]);

test.describe("/login", () => {
  test("renderiza o formulário", async ({ page }) => {
    await page.goto("/login");

    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Ateliê");
    await expect(page.getByLabel("E-mail")).toBeVisible();
    await expect(page.getByLabel("Senha")).toBeVisible();
    await expect(page.getByRole("button", { name: "Entrar" })).toBeVisible();
  });

  test("passa em axe sem violação grave (WCAG 2.1 AA)", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByRole("button", { name: "Entrar" })).toBeVisible();

    const { violations } = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();

    const leves = violations.filter((v) => !GRAVES.has(v.impact ?? ""));
    if (leves.length) {
      console.log(
        "axe (não bloqueante): " +
          leves.map((v) => `${v.id}[${v.impact}]x${v.nodes.length}`).join(", "),
      );
    }

    // Mensagem de falha mostra id + impacto + alvo, não um contador opaco.
    const graves = violations
      .filter((v) => GRAVES.has(v.impact ?? ""))
      .map((v) => `${v.id} [${v.impact}] → ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`);
    expect(graves).toEqual([]);
  });

  test("navega o formulário inteiro por teclado", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("E-mail").focus();

    await page.keyboard.type("teste@exemplo.com");
    await page.keyboard.press("Tab");
    await page.keyboard.type("senha-de-teste-1");
    await page.keyboard.press("Tab");

    await expect(page.getByRole("button", { name: "Entrar" })).toBeFocused();
  });

  test("não estoura o eixo horizontal", async ({ page }) => {
    await page.goto("/login");

    const excedente = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(excedente).toBeLessThanOrEqual(0);
  });
});
