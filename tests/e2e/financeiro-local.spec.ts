import { test as base, expect } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import type { Database } from "../../src/lib/database.types";
import { hojeSaoPaulo } from "../../src/lib/data";

// Serviço de autenticação, API e Postgres reais. Não usa banco nem usuário remoto.
base.skip(process.env.E2E_LOCAL !== "1", "Execute npm run test:e2e:local com Supabase local.");
const test = base.extend<{ conta: { db: SupabaseClient<Database>; email: string } }>({
  conta: async ({ page }, executarTeste) => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    if (new URL(url).origin !== "http://127.0.0.1:54321") throw new Error("E2E só aceita Supabase local na porta 54321.");
    const admin = createClient(url, process.env.E2E_LOCAL_SERVICE_ROLE!, { auth: { persistSession: false, autoRefreshToken: false } });
    const email = `jornada-${randomUUID()}@example.test`;
    const senha = `Teste-${randomUUID()}`;
    const { data, error } = await admin.auth.admin.createUser({ email, password: senha, email_confirm: true });
    if (error || !data.user) throw error ?? new Error("Falha criando usuário local.");
    try {
      const db = createClient<Database>(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
      const login = await db.auth.signInWithPassword({ email, password: senha });
      if (login.error) throw login.error;
      await page.goto("/login");
      await page.getByLabel("E-mail").fill(email);
      await page.getByLabel("Senha", { exact: true }).fill(senha);
      await page.getByRole("button", { name: "Entrar", exact: true }).click();
      await expect(page).toHaveURL(/\/dashboard/);
      await executarTeste({ db, email });
      await db.auth.signOut();
    } finally {
      const removido = await admin.auth.admin.deleteUser(data.user.id);
      if (removido.error) throw removido.error;
    }
  },
});

test("cria, edita e exporta transação com persistência real", async ({ page, conta }) => {
  await page.goto("/transacoes");
  const form = page.locator("form").filter({ has: page.getByRole("heading", { name: "Nova transação" }) });
  await form.getByLabel("Descrição", { exact: true }).fill("Compra da jornada");
  await form.getByLabel("Valor (R$)", { exact: true }).fill("100,00");
  await form.getByLabel("Forma de pagamento").selectOption("PIX");
  await form.getByRole("button", { name: "Registrar", exact: true }).click();
  await expect(page.getByText("Compra da jornada", { exact: true })).toBeVisible();
  const linha = page.locator("div.vidro-soberano").filter({ has: page.getByText("Compra da jornada", { exact: true }) });
  await linha.getByRole("button", { name: "Editar", exact: true }).click();
  const edicao = page.locator("form").filter({ has: page.getByRole("button", { name: "Salvar", exact: true }) });
  await edicao.getByLabel("Valor", { exact: true }).fill("125,01");
  await edicao.getByRole("button", { name: "Salvar", exact: true }).click();
  await expect.poll(async () => (await conta.db.from("transacoes_origem").select("valor_total").eq("descricao", "Compra da jornada").single()).data?.valor_total).toBe(12501);
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("link", { name: "Exportar CSV" }).click();
  const download = await downloadPromise;
  const conteudo = await readFile((await download.path())!, "utf8");
  expect(conteudo).toContain("Compra da jornada");
  expect(conteudo).toContain("125,01");
});

test("importa pagamento, concilia fatura uma vez e estorna pela tela", async ({ page, conta }) => {
  const cartao = await conta.db.rpc("criar_cartao", { p_nome: "Cartão jornada", p_limite_total: 100000, p_dia_fechamento: 20, p_dia_vencimento: 10 });
  expect(cartao.error).toBeNull();
  const cartaoId = (cartao.data as { cartao_id: string }).cartao_id;
  const compra = await conta.db.rpc("processar_transacao_completa", { p_descricao: "Consumo jornada", p_valor_total: 10000, p_tipo: "DESPESA", p_forma_pagamento: "CREDITO", p_cartao_id: cartaoId, p_data_compra: "2026-03-05", p_num_parcelas: 1 });
  expect(compra.error).toBeNull();
  const fatura = await conta.db.from("faturas").select("id, data_vencimento").eq("cartao_id", cartaoId).single();
  expect(fatura.error).toBeNull();
  const carteiraAntes = await conta.db.from("vw_carteira").select("saldo_caixa").single();
  await page.goto("/importar");
  await page.getByLabel("Banco / formato").selectOption("generico");
  await page.getByLabel("Arquivo do extrato").setInputFiles({ name: "extrato-jornada.csv", mimeType: "text/csv", buffer: Buffer.from(`data;descricao;valor\n${fatura.data!.data_vencimento};FATURA PAGA ITAU UNICLAS;-100,00\n`) });
  await page.getByRole("button", { name: "Importar 1 transação(ões)", exact: true }).click();
  await expect.poll(async () => (await conta.db.from("faturas").select("status").eq("id", fatura.data!.id).single()).data?.status).toBe("PAGA");
  const carteiraDepois = await conta.db.from("vw_carteira").select("saldo_caixa").single();
  expect(carteiraDepois.data!.saldo_caixa).toBe(carteiraAntes.data!.saldo_caixa - 10000);
  const liquidacoes = await conta.db.from("transacoes_origem").select("id").eq("natureza", "LIQUIDACAO_FATURA");
  expect(liquidacoes.data).toHaveLength(1);
  await page.goto("/faturas");
  await page.getByRole("button", { name: "Desfazer pagamento", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Desfazer pagamento", exact: true }).click();
  await expect.poll(async () => (await conta.db.from("faturas").select("status").eq("id", fatura.data!.id).single()).data?.status).not.toBe("PAGA");
});

test("paga e desfaz pagamento de fatura sem importação", async ({ page, conta }) => {
  const cartao = await conta.db.rpc("criar_cartao", { p_nome: "Cartão pagamento", p_limite_total: 100000, p_dia_fechamento: 20, p_dia_vencimento: 10 });
  expect(cartao.error).toBeNull();
  const compra = await conta.db.rpc("processar_transacao_completa", { p_descricao: "Compra pagamento", p_valor_total: 9999, p_tipo: "DESPESA", p_forma_pagamento: "CREDITO", p_cartao_id: (cartao.data as { cartao_id: string }).cartao_id, p_data_compra: "2026-03-05", p_num_parcelas: 1 });
  expect(compra.error).toBeNull();
  await page.goto("/faturas");
  await page.getByRole("button", { name: "Pagar fatura", exact: true }).first().click();
  await page.getByRole("dialog").getByRole("button", { name: "Pagar fatura", exact: true }).click();
  await expect.poll(async () => (await conta.db.from("faturas").select("status").single()).data?.status).toBe("PAGA");
  await expect(page.getByRole("button", { name: "Desfazer pagamento", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Desfazer pagamento", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Desfazer pagamento", exact: true }).click();
  await expect.poll(async () => (await conta.db.from("faturas").select("status").single()).data?.status).not.toBe("PAGA");
});

test("histórico de faturas alcança a página anterior", async ({ page, conta }) => {
  const cartao = await conta.db.rpc("criar_cartao", { p_nome: "Cartão histórico", p_limite_total: 100000, p_dia_fechamento: 20, p_dia_vencimento: 10 });
  expect(cartao.error).toBeNull();
  const compra = await conta.db.rpc("processar_transacao_completa", { p_descricao: "Compra em 25 vezes", p_valor_total: 25000, p_tipo: "DESPESA", p_forma_pagamento: "CREDITO", p_cartao_id: (cartao.data as { cartao_id: string }).cartao_id, p_data_compra: "2026-01-05", p_num_parcelas: 25 });
  expect(compra.error).toBeNull();
  await page.goto("/faturas");
  await page.getByRole("link", { name: "Mais antigas" }).click();
  await expect(page.getByText("Página 2", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Mais antigas" })).toHaveCount(0);
  await page.getByRole("link", { name: "Mais recentes" }).click();
  await expect(page.getByText("Página 1", { exact: true })).toBeVisible();
});

test("recupera senha com e-mail capturado localmente e recusa link reutilizado", async ({ page, request, conta }) => {
  await page.getByRole("button", { name: "Sair", exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.getByRole("link", { name: "Esqueci minha senha" }).click();
  await expect(page).toHaveURL(/\/login\/recuperar$/);
  await page.getByLabel("E-mail").fill(conta.email);
  await page.getByRole("button", { name: "Enviar link" }).click();
  await expect(page.getByRole("status")).toContainText("Se houver uma conta");
  let html = "";
  await expect.poll(async () => {
    const resposta = await request.get("http://127.0.0.1:54324/api/v1/messages");
    const caixa = await resposta.json() as { messages: { ID: string; To: { Address: string }[] }[] };
    const mensagem = caixa.messages.find((m) => m.To.some((destino) => destino.Address === conta.email));
    if (!mensagem) return false;
    const detalhe = await request.get(`http://127.0.0.1:54324/api/v1/message/${mensagem.ID}`);
    html = (await detalhe.json()).HTML;
    return html.includes("/auth/v1/verify");
  }).toBe(true);
  const link = [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1].replaceAll("&amp;", "&")).find((href) => href.includes("/auth/v1/verify"))!;
  if (new URL(link).origin !== "http://127.0.0.1:54321") throw new Error("Recuperação deve usar apenas serviço local.");
  await page.goto(link);
  await expect(page).toHaveURL("http://127.0.0.1:3100/login/nova-senha");
  const novaSenha = `Nova-${randomUUID()}`;
  await page.getByLabel("Nova senha", { exact: true }).fill(novaSenha);
  await page.screenshot({ path: test.info().outputPath("recuperacao-senha.png"), fullPage: true });
  await page.getByLabel("Confirmar senha").fill(novaSenha);
  await page.getByRole("button", { name: "Salvar senha" }).click();
  await expect(page.getByRole("status")).toContainText("Senha atualizada");
  expect((await conta.db.auth.signInWithPassword({ email: conta.email, password: novaSenha })).error).toBeNull();
  await page.goto(link);
  await expect(page).toHaveURL(/\/login\/recuperar/);
  await expect(page.getByRole("main").getByRole("alert")).toContainText("Link inválido ou expirado");
});

test("relatórios e CSV incluem mais de mil transações sem truncamento", async ({ page, conta }) => {
  test.setTimeout(60_000);
  const categoria = await conta.db.rpc("criar_categoria", { p_nome: "Volume", p_tipo: "DESPESA", p_orcamento_mensal: 110000 });
  expect(categoria.error).toBeNull();
  const regra = await conta.db.rpc("criar_regra_categorizacao", { p_padrao: "VOLUME", p_categoria_id: (categoria.data as { categoria_id: string }).categoria_id });
  expect(regra.error).toBeNull();
  const uid = (await conta.db.auth.getUser()).data.user!.id;
  if (!/^[0-9a-f-]{36}$/.test(uid)) throw new Error("ID de fixture inválido.");
  // Massa gerada pelas mesmas RPCs, sob role authenticated, dentro do container
  // local. A leitura exercitada pela tela continua pela API com teto de 1.000.
  execFileSync("docker", ["exec", "-i", "supabase_db_financeiro-web", "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-q"], {
    input: `begin; select set_config('request.jwt.claims','{"sub":"${uid}"}',true); set local role authenticated;
      select public.processar_transacao_completa('VOLUME ' || n,100,'DESPESA','PIX',null,'${hojeSaoPaulo()}',1) from generate_series(1,1203) n; commit;`,
    stdio: ["pipe", "pipe", "pipe"], timeout: 30000,
  });
  await page.goto("/dashboard");
  await expect(page.getByRole("heading", { name: /^Você já gastou/ })).toContainText("1.203,00");
  await page.goto("/analise");
  await expect(page.getByText("Envelope de Volume estourou", { exact: true })).toBeVisible();
  const resposta = await page.request.get("/transacoes/exportar?tipo=DESPESA");
  expect(resposta.status()).toBe(200);
  expect((await resposta.text()).trim().split("\r\n")).toHaveLength(1204);
});

test("edita cadastros nas quatro telas e mantém o saldo da meta", async ({ page, conta }) => {
  const cartao = await conta.db.rpc("criar_cartao", { p_nome: "Banco edição", p_limite_total: 100000, p_dia_fechamento: 20, p_dia_vencimento: 10 });
  expect(cartao.error).toBeNull();
  const categoria = await conta.db.rpc("criar_categoria", { p_nome: "Categoria edição", p_tipo: "DESPESA" });
  expect(categoria.error).toBeNull();
  const cofre = await conta.db.rpc("criar_cofrinho", { p_nome: "Meta edição", p_valor_alvo: 100000, p_horizonte: "MEDIO" });
  expect(cofre.error).toBeNull();
  const cofreId = (cofre.data as { cofrinho_id: string }).cofrinho_id;
  expect((await conta.db.rpc("aportar_cofrinho", { p_cofrinho_id: cofreId, p_valor: 500 })).error).toBeNull();
  expect((await conta.db.rpc("criar_recorrencia", { p_descricao: "Recorrência edição", p_valor: 10000, p_tipo: "DESPESA", p_forma_pagamento: "PIX", p_dia_do_mes: 5 })).error).toBeNull();
  for (const [rota, campo, valor] of [["cartoes", "Nome", "Banco alterado"], ["categorias", "Nome", "Categoria alterada"], ["cofrinhos", "Nome", "Meta alterada"], ["transacoes", "Descrição", "Recorrência alterada"]]) {
    await page.goto(`/${rota}`);
    await page.getByRole("button", { name: "Editar", exact: true }).click();
    const formulario = page.getByRole("form", { name: "Editar cadastro" });
    if (rota === "cartoes") await page.screenshot({ path: test.info().outputPath("editar-cartao.png"), fullPage: true });
    await formulario.getByLabel(campo, { exact: true }).fill(valor);
    await formulario.getByRole("button", { name: "Salvar alterações" }).click();
    await expect(page.getByText(valor, { exact: true })).toBeVisible();
  }
  expect((await conta.db.from("cofrinhos").select("saldo_atual").eq("id", cofreId).single()).data?.saldo_atual).toBe(500);
});
