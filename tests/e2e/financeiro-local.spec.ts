import { test as base, expect } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import type { Database } from "../../src/lib/database.types";
import { hojeSaoPaulo } from "../../src/lib/data";
import AxeBuilder from "@axe-core/playwright";
import { pdfFicticio, pdfFicticioColunas } from './pdf-ficticio';
import {pdfDigitalizado} from './pdf-digitalizado';

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

test('reserva inteligente: simula, salva preferências e mantém aportes explícitos',async({page,conta},testInfo)=>{
 const cofre=await conta.db.rpc('criar_cofrinho',{p_nome:'Reserva planejada',p_valor_alvo:1000000,p_horizonte:'CURTO'});expect(cofre.error).toBeNull();
 await page.goto('/cofrinhos');
 const painel=page.getByRole('region',{name:'Quanto posso reservar?'});
 await expect(painel).toBeVisible();
 for(const [rotulo,valor] of [['Quanto desejo guardar por mês','1500,00'],['Margem de segurança','500,00'],['Caixa livre hoje','2000,00'],['Compromissos ainda a pagar','300,00'],['Receita mensal para simulação','6000,00'],['Gasto mensal para simulação','4300,00']])await painel.getByLabel(new RegExp(rotulo)).fill(valor);
 await painel.getByRole('checkbox').check();
 await expect(painel).toContainText('R$ 1.200,00 disponíveis para esta proposta');
 await painel.getByRole('button',{name:'Salvar preferências'}).click();
 await expect(painel.getByRole('status')).toContainText('Nenhum aporte foi realizado');
 expect((await conta.db.from('movimentacoes_cofrinho').select('id')).data).toEqual([]);
 await page.reload();await expect(painel.getByLabel(/Quanto desejo guardar/)).toHaveValue('1500,00');
 await painel.getByRole('checkbox').check();
 expect((await new AxeBuilder({page}).include('section[aria-labelledby="titulo-reserva"]').analyze()).violations).toEqual([]);
 for(const tema of ['claro','escuro']){
  await page.evaluate(t=>document.documentElement.dataset.tema=t,tema);
  for(const largura of [320,375,768,1024,1440,1920]){
   await page.setViewportSize({width:largura,height:900});
   expect(await page.locator('body *').evaluateAll(es=>es.filter(e=>e.getBoundingClientRect().right>window.innerWidth+1).map(e=>({tag:e.tagName,classe:e.className,direita:e.getBoundingClientRect().right})).slice(0,12))).toEqual([]);
   expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
   if([320,768,1024,1440].includes(largura))await page.screenshot({path:testInfo.outputPath(`reserva-${tema}-${largura}.png`),fullPage:true});
  }
 }
 await page.setViewportSize({width:320,height:900});
 await painel.getByLabel(/Caixa livre hoje/).focus();await page.keyboard.press('Tab');
 await expect(painel.getByLabel(/Compromissos ainda a pagar/)).toBeFocused();
 await painel.getByLabel(/Caixa livre hoje/).fill('0,00');await painel.getByRole('checkbox').check();
 await expect(painel).toContainText('R$ 0,00 disponíveis para esta proposta');
 // Regressões do revisor: arquivo com >1.000 movimentos e cofre arquivado.
 const arquivado=await conta.db.rpc('criar_cofrinho',{p_nome:'Meta arquivada',p_valor_alvo:1000000,p_horizonte:'CURTO'});expect(arquivado.error).toBeNull();
 const arquivadoId=(arquivado.data as {cofrinho_id:string}).cofrinho_id;
 const uid=(await conta.db.auth.getUser()).data.user!.id;
 if(!/^[0-9a-f-]{36}$/.test(uid)||!/^[0-9a-f-]{36}$/.test(arquivadoId))throw new Error('ID de fixture inválido.');
 execFileSync('docker',['exec','-i','supabase_db_financeiro-web','psql','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-q'],{
  input:`begin; select set_config('request.jwt.claims','{"sub":"${uid}"}',true); set local role authenticated; select public.aportar_cofrinho('${arquivadoId}',100) from generate_series(1,1003); commit;`,stdio:['pipe','pipe','pipe'],timeout:30000,
 });
 expect((await conta.db.rpc('arquivar_cofrinho',{p_cofrinho_id:arquivadoId,p_arquivado:true})).error).toBeNull();
 await page.reload();await painel.getByRole('checkbox').check();
 await expect(painel).toContainText('R$ 197,00 disponíveis para esta proposta');
});

test('XLSX seguro: arquivo comprimido continua para revisão no navegador',async({page,conta})=>{
 const excel=await import('exceljs');const Workbook=excel.Workbook??excel.default.Workbook;
 const wb=new Workbook();const aba=wb.addWorksheet('Extrato');
 aba.addRow(['Data','Descrição','Valor']);aba.addRow(['01/10/2026','MERCADO XLSX TESTE',-12.34]);
 const bytes=await wb.xlsx.writeBuffer({zip:{compression:'DEFLATE'}});
 await page.goto('/importar');
 await page.getByLabel('O que você quer importar?').selectOption('extrato');
 await page.getByLabel('Arquivo do extrato (CSV, OFX, OFC, XLSX ou PDF)').setInputFiles({name:'extrato-sintetico.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:Buffer.from(bytes)});
 await expect(page.getByRole('button',{name:/Importar 1 transa/})).toBeVisible();
 await expect(page.getByText('MERCADO XLSX TESTE').first()).toBeVisible();
 const transacoes=await conta.db.from('transacoes_origem').select('id');expect(transacoes.data).toEqual([]);
});

test('orçamentos: limites independentes por mês e zero pela interface',async({page,conta})=>{
 const categoria=await conta.db.rpc('criar_categoria',{p_nome:'Mercado mensal',p_tipo:'DESPESA'});expect(categoria.error).toBeNull();
 await page.goto('/orcamentos?mes=2030-10');
 const secao=page.getByRole('region',{name:'Orçamento de Mercado mensal'});
 await secao.getByLabel('Limite de Mercado mensal em reais').fill('0,00');
 await secao.getByRole('button',{name:'Salvar limite do mês'}).click();
 await expect(secao).toContainText('Definido para este mês');
 const outubro=(await conta.db.from('orcamentos_mensais').select('*').eq('mes','2030-10-01')).data!;expect(outubro[0].limite).toBe(0);
 await page.goto('/orcamentos?mes=2030-11');await expect(secao).toContainText('Sem limite');
 await secao.getByLabel('Limite de Mercado mensal em reais').fill('250,00');await secao.getByRole('button',{name:'Salvar limite do mês'}).click();
 await expect(secao).toContainText('R$ 250,00');
 expect((await conta.db.from('orcamentos_mensais').select('*').eq('mes','2030-10-01')).data![0].limite).toBe(0);
 await expect(page.getByRole('heading',{name:'Orçamentos mensais'})).toBeVisible();
 const a11y=await new AxeBuilder({page}).analyze();expect(a11y.violations).toEqual([]);
});

test('contas: importar, vincular sem duplicar gasto, conferir saldo e reabrir',async({page,conta})=>{
 test.setTimeout(150_000);
 await page.goto('/contas');
 await page.getByLabel('Nome da conta').fill('Conta de teste');await page.getByLabel('Saldo inicial em reais').fill('100,00');await page.getByLabel('Data de início').fill('2026-09-01');
 await page.getByRole('button',{name:'Cadastrar conta',exact:true}).click();
 await expect(page.getByLabel('Conta',{exact:true})).toContainText('Conta de teste');
 await page.getByLabel('Mês da conferência').fill('2026-09');
 const t=await conta.db.rpc('processar_transacao_completa',{p_descricao:'Mercado conciliação',p_valor_total:1234,p_tipo:'DESPESA',p_forma_pagamento:'DEBITO',p_data_compra:'2026-09-03'});expect(t.error).toBeNull();
 await page.getByRole('button',{name:'Atualizar conferência'}).click();
 await page.getByLabel('Arquivo para a conta selecionada').setInputFiles({name:'extrato-teste.csv',mimeType:'text/csv',buffer:Buffer.from('Data;Descrição;Valor\n03/09/2026;Mercado conciliação;-12,34','utf8')});
 const linha=page.getByRole('region',{name:'Movimentação Mercado conciliação'});await expect(linha).toBeVisible();
 const tid=(t.data as {transacao_id:string}).transacao_id;
 await linha.getByLabel('Como tratar esta movimentação').selectOption('VINCULAR:'+tid);await linha.getByRole('button',{name:'Confirmar tratamento'}).click();
 await expect(linha).toContainText('Conciliada');expect((await conta.db.from('transacoes_origem').select('id')).data).toHaveLength(1);
 await page.getByLabel('Saldo final no banco em reais').fill('87,66');await page.getByRole('button',{name:'Conferir e fechar até esta data'}).click();
 await expect(page.getByText('Fechado até 2026-09-30.')).toBeVisible();
 await page.getByLabel('Motivo para reabrir').fill('Conferir novamente o extrato');await page.getByRole('button',{name:'Reabrir conferência'}).click();
 await expect(page.getByText('Fechado até 2026-09-30.')).toHaveCount(0);
 for(const largura of [320,375,768,1024,1440,1920]){
  await page.setViewportSize({width:largura,height:900});
  for(const tema of ['claro','escuro']){
   await page.evaluate(t=>document.documentElement.setAttribute('data-tema',t),tema);
   expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
   if([320,768,1024,1440].includes(largura))await page.screenshot({path:test.info().outputPath(`contas-${largura}-${tema}.png`),fullPage:true});
  }
 }
 const a11y=await new AxeBuilder({page}).analyze();expect(a11y.violations).toEqual([]);
 await page.getByText('Conexão pessoal com Meu Pluggy',{exact:true}).click();await expect(page.getByText('A integração ainda precisa ser configurada pelo titular. Você pode continuar usando arquivos de extrato.')).toBeVisible();
});

test('OCR: PDF digitalizado é lido localmente e permanece para revisão',async({page,conta})=>{
 test.setTimeout(180_000);
 const c=await conta.db.rpc('criar_conta_bancaria',{p_nome:'Conta OCR',p_saldo_inicial:0,p_data_inicial:'2030-10-01'});expect(c.error).toBeNull();
 await page.goto('/contas');await page.getByLabel('Mês da conferência').fill('2030-10');
 const jpeg=await page.evaluate(()=>{const canvas=document.createElement('canvas');canvas.width=1200;canvas.height=1600;const ctx=canvas.getContext('2d')!;ctx.fillStyle='white';ctx.fillRect(0,0,1200,1600);ctx.fillStyle='black';ctx.font='32px Arial';ctx.fillText('EXTRATO BANCARIO',60,100);ctx.fillText('03/10/2030 MERCADO DIGITAL 12,34 D',60,200);return canvas.toDataURL('image/jpeg',0.95).split(',')[1];});
 const pdf=pdfDigitalizado(Buffer.from(jpeg,'base64'),1200,1600);
 const externos:string[]=[];page.on('request',r=>{const u=new URL(r.url());if(u.protocol.startsWith('http')&&u.hostname!=='127.0.0.1')externos.push(u.hostname);});
 await page.getByLabel('Ler PDF digitalizado com OCR',{exact:true}).check();
 await page.getByLabel('Arquivo para a conta selecionada').setInputFiles({name:'extrato-digitalizado-teste.pdf',mimeType:'application/pdf',buffer:pdf});
 await expect(page.getByRole('region',{name:/Movimentação MERCADO DIGITAL/})).toBeVisible({timeout:120_000});
 const linhas=await conta.db.from('linhas_extrato_conta').select('*');expect(linhas.error).toBeNull();expect(linhas.data).toHaveLength(1);expect(linhas.data![0].valor).toBe(-1234);
 expect((await conta.db.from('transacoes_origem').select('id')).data).toHaveLength(0);
 expect(externos).toEqual([]);
 await page.screenshot({path:test.info().outputPath('ocr-extrato-revisao.png'),fullPage:true});
});

test('planejamento: meses, alertas e cobranças vinculadas sem dupla contagem',async({page,conta})=>{
 test.setTimeout(180_000);
 const erros:string[]=[];page.on('pageerror',e=>erros.push(e.message));
 const c=await conta.db.rpc('criar_cartao',{p_nome:'Cartão planejamento fictício',p_limite_total:100000,p_dia_fechamento:20,p_dia_vencimento:8});
 expect(c.error).toBeNull();const cartaoId=(c.data as {cartao_id:string}).cartao_id;
 const assinatura=await conta.db.rpc('criar_assinatura',{p_nome:'Serviço planejamento',p_valor:3000,p_periodicidade:'MENSAL',p_proxima_cobranca:'2030-11-10',p_cartao_id:cartaoId});
 expect(assinatura.error).toBeNull();const aid=(assinatura.data as {assinatura_id:string}).assinatura_id;
 const atual=await conta.db.rpc('confirmar_fatura_importada',{p_chave:randomUUID(),p_sha:null,p_cartao_id:cartaoId,p_competencia:'2030-10-01',p_origem:'PDF',p_total:10000,p_linhas:[{data:'2030-10-01',descricao:'PARCELA PLANEJAMENTO',valor:10000,tipo:'PARCELA',parcela_numero:1,parcelas_total:3}]});
 expect(atual.error).toBeNull();
 const plano=(await conta.db.from('planos_parcelamento').select('id').single()).data!.id;
 const seguinte=await conta.db.rpc('confirmar_fatura_importada',{p_chave:randomUUID(),p_sha:null,p_cartao_id:cartaoId,p_competencia:'2030-11-01',p_origem:'PDF',p_total:13000,p_linhas:[{data:'2030-10-01',descricao:'PARCELA PLANEJAMENTO',valor:10000,tipo:'PARCELA',parcela_numero:2,parcelas_total:3,plano_id:plano},{data:'2030-11-10',descricao:'Serviço planejamento',valor:3000,tipo:'ASSINATURA',decisao_assinatura:'VINCULAR',assinatura_id:aid}]});
 expect(seguinte.error).toBeNull();
 const hoje=hojeSaoPaulo();const proxima=new Date(hoje+'T12:00:00Z');proxima.setUTCDate(proxima.getUTCDate()+3);
 for(let i=0;i<2;i++)expect((await conta.db.rpc('criar_assinatura',{p_nome:'Alerta fictício',p_valor:1000,p_periodicidade:'MENSAL',p_proxima_cobranca:proxima.toISOString().slice(0,10)})).error).toBeNull();
 const antes=(await conta.db.from('transacoes_origem').select('id')).data!.length;
 await page.goto('/planejamento?mes=2030-10');
 await expect(page.getByRole('heading',{name:'Planejamento',exact:true})).toBeVisible();
 const compromissos=page.getByRole('region',{name:'Compromissos dos próximos 12 meses'});
 await expect(compromissos.locator('summary')).toHaveCount(12);
 await compromissos.locator('summary').filter({hasText:'novembro 2030'}).click();
 const novembro=page.getByRole('region',{name:'Cartão planejamento fictício em 2030-11'});
 await expect(novembro.getByText('Registrado na fatura').locator('..')).toContainText('R$ 130,00');
 await expect(novembro.getByText('Parcelas previstas').locator('..')).toContainText('R$ 0,00');
 await expect(novembro.getByText('Assinaturas previstas',{exact:true}).locator('..')).toContainText('R$ 0,00');
 await expect(page.getByRole('link',{name:'Possível duplicidade · Alerta fictício'})).toBeVisible();
 const aba=compromissos.locator('summary').first();await aba.focus();await page.keyboard.press('Enter');
 await expect(aba.locator('..')).not.toHaveAttribute('open','');await page.keyboard.press('Enter');
 await page.emulateMedia({reducedMotion:'reduce'});
 for(const tema of ['escuro','claro']) {
  await page.evaluate(t=>{if(t==='claro')document.documentElement.setAttribute('data-tema','claro');else document.documentElement.removeAttribute('data-tema');},tema);
  for(const largura of [320,375,768,1024,1440,1920]) {
   await page.setViewportSize({width:largura,height:900});
   await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(largura);
   await page.evaluate(()=>window.scrollTo(0,0));
   await page.screenshot({path:test.info().outputPath(`planejamento-${tema}-${largura}.png`),fullPage:true});
  }
  expect((await new AxeBuilder({page}).analyze()).violations).toEqual([]);
 }
 expect((await conta.db.from('transacoes_origem').select('id')).data).toHaveLength(antes);
 if(process.env.AUDIT_PLANEJAMENTO==='1'&&test.info().project.name==='desktop-1440') {
  const saida=execFileSync(process.execPath,['tests/e2e/auditar-rota-autenticada.mjs',page.url(),test.info().outputPath('lighthouse-planejamento.json')],{input:JSON.stringify(await page.context().cookies()),encoding:'utf8',stdio:['pipe','pipe','pipe'],timeout:120000});
  console.log(`Lighthouse Planejamento: ${saida.trim()}`);
 }
 expect(erros).toEqual([]);
});

test('reversão: prévia, confirmação, histórico e reimportação do arquivo',async({page,conta})=>{
 test.setTimeout(120_000);
 const c=await conta.db.rpc('criar_cartao',{p_nome:'Cartão reversão fictício',p_limite_total:100000,p_dia_fechamento:20,p_dia_vencimento:8});
 expect(c.error).toBeNull();const cartaoId=(c.data as {cartao_id:string}).cartao_id;
 const chave=randomUUID();const linhas=[{data:'2030-10-01',descricao:'COMPRA REVERSAO FICTICIA',valor:1234,tipo:'GASTO'}];
 const criar=()=>conta.db.rpc('confirmar_fatura_importada',{p_chave:randomUUID(),p_sha:'a'.repeat(64),p_cartao_id:cartaoId,p_competencia:'2030-10-01',p_origem:'PDF',p_total:1234,p_linhas:linhas});
 expect((await conta.db.rpc('confirmar_fatura_importada',{p_chave:chave,p_sha:'a'.repeat(64),p_cartao_id:cartaoId,p_competencia:'2030-10-01',p_origem:'PDF',p_total:1234,p_linhas:linhas})).error).toBeNull();
 await page.goto('/importar');await page.getByRole('button',{name:'Conferir reversão'}).click();
 await expect(page.getByRole('region',{name:'Prévia da reversão'})).toContainText('R$ 12,34');
 expect((await conta.db.from('transacoes_origem').select('id')).data).toHaveLength(1);
 await page.getByText('Conferir lançamentos deste lote').click();
 await expect(page.getByText(/COMPRA REVERSAO FICTICIA/)).toBeVisible();
 for(const tema of ['escuro','claro']) {
  await page.evaluate(t=>{if(t==='claro')document.documentElement.setAttribute('data-tema','claro');else document.documentElement.removeAttribute('data-tema');},tema);
  for(const largura of [320,375,768,1024,1440,1920]) {
   await page.setViewportSize({width:largura,height:900});
   await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(largura);
   await page.evaluate(()=>window.scrollTo(0,0));
   await page.screenshot({path:test.info().outputPath(`reversao-${tema}-${largura}.png`),fullPage:true});
  }
  expect((await new AxeBuilder({page}).analyze()).violations).toEqual([]);
 }
 await page.getByRole('button',{name:'Desfazer esta importação'}).click();
 await expect(page.getByRole('dialog')).toContainText('R$ 12,34');
 await page.getByRole('button',{name:'Desfazer importação',exact:true}).click();
 await expect(page.getByRole('status')).toContainText('Importação desfeita');
 await expect(page.getByText(/lançamento\(s\) · Desfeita/)).toBeVisible();
 expect((await conta.db.from('transacoes_origem').select('id')).data).toHaveLength(0);
 const reimportada=await criar();expect(reimportada.error).toBeNull();expect((reimportada.data as {criadas:number}).criadas).toBe(1);
 await page.getByRole('button',{name:'Atualizar histórico'}).click();
 await expect(page.getByRole('button',{name:'Conferir reversão'})).toHaveCount(1);
 const usuario=(await conta.db.auth.getUser()).data.user!.id;expect(usuario).toMatch(/^[a-f0-9-]{36}$/);
 execFileSync('docker',['exec','-i','supabase_db_financeiro-web','psql','-U','postgres','-d','postgres','-q','-v','ON_ERROR_STOP=1'],{input:`insert into public.importacoes(user_id,origem,status) values('${usuario}','CSV','CONFIRMADA');`,stdio:['pipe','pipe','pipe'],timeout:15000});
 await page.getByRole('button',{name:'Atualizar histórico'}).click();
 await expect(page.getByText('Quantidade não disponível',{exact:false})).toBeVisible();
 await page.getByRole('listitem').filter({hasText:'Extrato CSV'}).getByRole('button',{name:'Conferir reversão'}).click();
 await expect(page.getByRole('region',{name:'Prévia da reversão'})).toContainText('não possui vínculo suficiente');
 await expect(page.getByRole('button',{name:'Desfazer esta importação'})).toBeDisabled();
});

test('maiores despesas mantém descrição, data e valor dentro do cartão',async({page,conta})=>{
 const descricao='DESPESA FICTICIA COM DESCRICAO MUITO LONGA '+ 'REFERENCIA'.repeat(14);
 const criada=await conta.db.rpc('processar_transacao_completa',{p_descricao:descricao,p_valor_total:123456789,p_tipo:'DESPESA',p_forma_pagamento:'DEBITO',p_cartao_id:null,p_data_compra:'2026-09-10',p_num_parcelas:1});
 expect(criada.error).toBeNull();
 await page.goto('/dashboard?mes=2026-09');
 const cartao=page.getByRole('heading',{name:'Maiores despesas',exact:true}).locator('../..');
 await expect(cartao.getByText('R$ 1.234.567,89',{exact:true})).toBeVisible();
 for(const largura of [320,768,1024,1191,1440]){
  await page.setViewportSize({width:largura,height:900});
  const enquadrado=await cartao.evaluate(card=>{
   const limite=card.getBoundingClientRect();
   return [...card.querySelectorAll('li')].every(l=>{
    const r=l.getBoundingClientRect();
    return l.scrollWidth<=l.clientWidth && r.left>=limite.left && r.right<=limite.right;
   });
  });
  expect(enquadrado).toBe(true);
  // Aguardar a geometria final após a troca do viewport.
  await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(largura);
  await cartao.screenshot({path:test.info().outputPath(`maiores-despesas-${largura}.png`)});
 }
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
    // O painel de reserva também mostra o nome da meta: conferir o cartão
    // que contém os controles de aporte, sem escolher arbitrariamente uma cópia.
    const resultado = rota === "cofrinhos"
      ? page.locator("div.vidro-soberano").filter({ has: page.getByLabel("Tipo de movimentação", { exact: true }) })
      : page;
    await expect(resultado.getByText(valor, { exact: true })).toBeVisible();
  }
  expect((await conta.db.from("cofrinhos").select("saldo_atual").eq("id", cofreId).single()).data?.saldo_atual).toBe(500);
});
