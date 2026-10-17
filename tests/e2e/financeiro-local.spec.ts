import { test as base, expect } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import type { Database } from "../../src/lib/database.types";
import { hojeSaoPaulo } from "../../src/lib/data";
import AxeBuilder from "@axe-core/playwright";
import { pdfFicticio, pdfFicticioColunas } from './pdf-ficticio';

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

test('Itaú duas colunas: pagamento, moeda, IOF, futuras e competência sem misturar',async({page,conta})=>{
 test.setTimeout(180_000);
 const erros:string[]=[];page.on('pageerror',e=>erros.push(e.message));
 const c=await conta.db.rpc('criar_cartao',{p_nome:'Cartão colunas',p_limite_total:100000,p_dia_fechamento:1,p_dia_vencimento:8});
 expect(c.error).toBeNull();const id=(c.data as {cartao_id:string}).cartao_id;
 const arquivo={name:'fatura-ficticia-colunas.pdf',mimeType:'application/pdf',buffer:pdfFicticioColunas()};
 await page.goto('/importar');
 await expect(page.getByLabel('O que você quer importar?')).toHaveValue('');
 await page.getByLabel('O que você quer importar?').selectOption('extrato');
 await page.getByLabel('Arquivo do extrato').setInputFiles(arquivo);
 await expect(page.getByRole('alert').filter({hasText:'fatura de cartão'})).toContainText('fatura de cartão');
 expect((await conta.db.from('importacoes').select('id')).data).toHaveLength(0);
 await page.getByLabel('O que você quer importar?').selectOption('fatura');
 await page.getByLabel('Cartão da fatura').selectOption(id);await page.getByLabel('Mês da fatura').fill('2026-09');
 await page.getByLabel(/Arquivo da fatura/).setInputFiles(arquivo);
 await expect(page.getByRole('heading',{name:/Confira a fatura/})).toBeVisible();
 await expect(page.getByText(/Cobranças selecionadas/)).toContainText('208,02');
 await expect(page.getByText(/Cobranças selecionadas/)).toContainText('164,18');
 expect((await new AxeBuilder({page}).analyze()).violations).toEqual([]);
 await page.getByLabel('Decisão sobre assinatura da linha 3').selectOption('NOVA');
 await page.getByLabel('Próxima cobrança da linha 3').fill('2027-11-20');
 await page.getByLabel('Decisão sobre assinatura da linha 4').selectOption('NAO');
 for(const checkbox of await page.getByLabel(/Conferi a data sugerida da linha/).all())await checkbox.check();
 for(const tema of ['escuro','claro']){
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.evaluate(t=>{if(t==='claro')document.documentElement.setAttribute('data-tema','claro');else document.documentElement.removeAttribute('data-tema');},tema);
  for(const largura of [320,375,768,1024,1440,1920]){
   await page.setViewportSize({width:largura,height:900});
   expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
   await page.screenshot({path:test.info().outputPath(`colunas-${tema}-${largura}.png`),fullPage:true});
  }
  expect((await new AxeBuilder({page}).analyze()).violations).toEqual([]);
 }
 await page.getByRole('button',{name:'Confirmar importação da fatura'}).focus();await page.keyboard.press('Enter');
 await expect(page.getByRole('status')).toContainText('4 cobrança(s) registrada(s)');
 const efetivas=await conta.db.from('parcelas').select('valor');expect(efetivas.data?.reduce((s,l)=>s+l.valor,0)).toBe(20802);
 const previstas=await conta.db.from('vw_previsoes_parcelamento').select('valor');expect(previstas.data?.map(p=>p.valor)).toEqual([8209,8209]);
 expect((await conta.db.from('recorrencias').select('id').eq('finalidade','ASSINATURA')).data).toHaveLength(1);
 const movimentos=await conta.db.from('vw_movimentos_competencia').select('valor_total,data_compra');
 expect(movimentos.error).toBeNull();expect(movimentos.data).toHaveLength(4);
 expect(movimentos.data?.every(m=>m.data_compra==='2026-09-01')).toBe(true);
 expect(movimentos.data?.reduce((s,m)=>s+m.valor_total,0)).toBe(20802);
 await page.goto('/dashboard?mes=2026-09');await expect(page.getByRole('heading',{name:'Dashboard'})).toBeVisible();
 await page.goto('/analise?mes=2026-09');await expect(page.getByRole('heading',{name:'Análise',exact:true})).toBeVisible();
 await expect(page.getByRole('link',{name:'Mês anterior'})).toHaveAttribute('href','/analise?mes=2026-08');
 expect(erros).toEqual([]);
});

test('fatura Itaú PDF: revisão, parcelas futuras, assinatura e mês seguinte sem duplicidade',async({page,conta})=>{
 test.setTimeout(180_000);
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 const cartao=await conta.db.rpc('criar_cartao',{p_nome:'Itaú teste',p_limite_total:100000,p_dia_fechamento:25,p_dia_vencimento:10});
 expect(cartao.error).toBeNull();const id=(cartao.data as {cartao_id:string}).cartao_id;
 const pdf=pdfFicticio(['ITAU - FATURA FICTICIA','05/10 LOJA MOVEIS 03/10 100,00','06/10 NETFLIX.COM 39,90','07/10 MERCADO 25,00','Total desta fatura 164,90']);
 await page.goto('/importar');await page.getByLabel('O que você quer importar?').selectOption('fatura');
 await page.getByLabel('Cartão da fatura').selectOption(id);await page.getByLabel('Mês da fatura').fill('2026-10');
 await page.getByLabel(/Arquivo da fatura/).setInputFiles({name:'itau-ficticio.pdf',mimeType:'application/pdf',buffer:pdf});
 await expect(page.getByRole('heading',{name:/Confira a fatura/})).toBeVisible();
 await expect(page.getByLabel('Parcela atual da linha 1')).toHaveValue('3');
 await page.getByLabel('Decisão sobre assinatura da linha 2').selectOption('NOVA');
 await page.getByLabel('Próxima cobrança da linha 2').fill('2027-11-06');
 for(const checkbox of await page.getByLabel(/Conferi a data sugerida da linha/).all())await checkbox.check();
 for(const tema of ['escuro','claro']) {
  await page.evaluate(t=>{if(t==='claro')document.documentElement.setAttribute('data-tema','claro');else document.documentElement.removeAttribute('data-tema');},tema);
  for(const largura of [320,375,768,1024,1440,1920]) {
   await page.setViewportSize({width:largura,height:900});
   expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
   await page.screenshot({path:test.info().outputPath(`fatura-${tema}-${largura}.png`),fullPage:true});
  }
  expect((await new AxeBuilder({page}).analyze()).violations).toEqual([]);
 }
 await page.getByRole('button',{name:'Confirmar importação da fatura'}).focus();await page.keyboard.press('Enter');
 await expect(page.getByRole('status')).toContainText('3 cobrança(s) registrada(s)');
 expect((await conta.db.from('transacoes_origem').select('id,forma_pagamento')).data).toHaveLength(3);
 const efetivas=await conta.db.from('parcelas').select('valor');expect(efetivas.data?.reduce((s,l)=>s+l.valor,0)).toBe(16490);
 expect((await conta.db.from('recorrencias').select('id').eq('finalidade','ASSINATURA')).data).toHaveLength(1);
 expect((await conta.db.from('vw_previsoes_parcelamento').select('*')).data).toHaveLength(7);
 await page.reload();await page.getByLabel('O que você quer importar?').selectOption('fatura');
 await page.getByLabel('Cartão da fatura').selectOption(id);await page.getByLabel('Mês da fatura').fill('2026-10');
 await page.getByLabel(/Arquivo da fatura/).setInputFiles({name:'itau-ficticio.pdf',mimeType:'application/pdf',buffer:pdf});
 await expect(page.getByRole('heading',{name:/Confira a fatura/})).toBeVisible();
 await page.getByRole('button',{name:'Descartar revisão'}).click();
 const plano=(await conta.db.from('planos_parcelamento').select('id').single()).data!.id;
 await page.getByLabel('Mês da fatura').fill('2026-11');
 await page.getByLabel(/Arquivo da fatura/).setInputFiles({name:'itau-novembro.pdf',mimeType:'application/pdf',buffer:pdfFicticio(['05/11 LOJA MOVEIS 04/10 100,00','Total desta fatura 100,00'])});
 await expect(page.getByRole('heading',{name:/Confira a fatura/})).toBeVisible();
 await page.getByLabel('Vínculo da linha 1').selectOption(plano);
 for(const checkbox of await page.getByLabel(/Conferi a data sugerida da linha/).all())await checkbox.check();
 await page.getByRole('button',{name:'Confirmar importação da fatura'}).click();
 await expect(page.getByRole('status')).toContainText('1 cobrança(s) registrada(s)');
 expect((await conta.db.from('vw_previsoes_parcelamento').select('*')).data).toHaveLength(6);
 expect((await conta.db.from('parcelas').select('valor')).data?.reduce((s,l)=>s+l.valor,0)).toBe(26490);
 await page.getByRole('button',{name:'Consultar previsões deste cartão'}).click();
 await expect(page.getByText(/6 parcela\(s\) prevista/)).toBeVisible();
 await page.getByLabel('Valor previsto por parcela (R$)').fill('110,00');
 await page.getByRole('button',{name:'Atualizar somente previsões'}).click();
 await expect.poll(async()=>(await conta.db.from('planos_parcelamento').select('valor_previsto').single()).data?.valor_previsto).toBe(11000);
 expect(errors).toEqual([]);
});

test("central de assinaturas persiste contrato e status sem duplicar despesas", async ({ page, conta }) => {
  test.setTimeout(120_000);
  const cartao = await conta.db.rpc("criar_cartao", { p_nome: "Cartão assinaturas", p_limite_total: 100000, p_dia_fechamento: 20, p_dia_vencimento: 10 });
  expect(cartao.error).toBeNull();
  const cartaoId = (cartao.data as { cartao_id: string }).cartao_id;
  const ano = Number(hojeSaoPaulo().slice(0, 4)) + 1;
  await page.goto("/assinaturas");
  await page.getByRole("button", { name: "Nova assinatura" }).click();
  await page.getByLabel("Serviço ou assinatura").fill("Streaming da jornada");
  await page.getByLabel("Valor por cobrança (R$)").fill("49,90");
  await page.getByLabel("Próxima cobrança", { exact: true }).fill(`${ano}-02-28`);
  await page.getByRole("combobox", { name: "Cartão", exact: true }).selectOption(cartaoId);
  await page.getByRole("button", { name: "Cadastrar assinatura", exact: true }).click();
  await expect(page.getByRole("button", { name: "Editar Streaming da jornada" })).toBeVisible();
  const contrato = async () => (await conta.db.from("recorrencias").select("valor,status,cartao_id").eq("finalidade", "ASSINATURA").single()).data;
  expect(await contrato()).toMatchObject({ valor: 4990, status: "ATIVA", cartao_id: cartaoId });
  await page.getByRole("button", { name: "Editar Streaming da jornada" }).click();
  await page.getByLabel("Valor por cobrança (R$)").fill("59,90");
  await page.getByRole("button", { name: "Salvar alterações", exact: true }).click();
  await expect.poll(async () => (await contrato())?.valor).toBe(5990);
  await page.reload();
  await expect(page.getByRole("button", { name: "Pausar Streaming da jornada" })).toBeVisible();

  // Capturas reais da rota autenticada, nos temas existentes e breakpoints.
  for (const tema of ["escuro", "claro"]) {
    await page.evaluate((tema) => {
      if (tema === "claro") document.documentElement.setAttribute("data-tema", "claro");
      else document.documentElement.removeAttribute("data-tema");
    }, tema);
    for (const largura of [320, 375, 768, 1024, 1440, 1920]) {
      await page.setViewportSize({ width: largura, height: 900 });
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await page.screenshot({ path: test.info().outputPath(`assinaturas-${tema}-${largura}.png`), fullPage: true });
    }
    const a11y = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
    expect(a11y.violations).toEqual([]);
  }
  await page.getByRole("button", { name: "Pausar Streaming da jornada" }).focus();
  await page.keyboard.press("Enter");
  await expect.poll(async () => (await contrato())?.status).toBe("PAUSADA");
  await expect(page.getByRole("button", { name: "Reativar Streaming da jornada" })).toBeVisible();
  await page.getByRole("button", { name: "Reativar Streaming da jornada" }).click();
  await expect.poll(async () => (await contrato())?.status).toBe("ATIVA");
  await expect(page.getByRole("button", { name: "Pausar Streaming da jornada" })).toBeVisible();
  await page.getByRole("button", { name: "Cancelar Streaming da jornada" }).click();
  const dialogo = page.getByRole("dialog", { name: "Cancelar assinatura" });
  await expect(dialogo).toContainText("não cancela junto ao fornecedor");
  await dialogo.getByRole("button", { name: "Cancelar assinatura", exact: true }).click();
  await expect.poll(async () => (await contrato())?.status).toBe("CANCELADA");
  await page.reload();
  await expect(page.getByText("cancelada", { exact: true })).toBeVisible();
  expect((await conta.db.from("transacoes_origem").select("id")).data).toEqual([]);
  expect((await conta.db.from("faturas").select("id")).data).toEqual([]);
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
  await page.getByLabel('O que você quer importar?').selectOption('extrato');
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
