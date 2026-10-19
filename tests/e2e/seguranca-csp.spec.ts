import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';

function pdfComImagem(jpeg:Buffer):Buffer {
 const partes:Buffer[]=[Buffer.from('%PDF-1.4\n')];const offsets:number[]=[0];
 const objetos=[Buffer.from('<< /Type /Catalog /Pages 2 0 R >>'),Buffer.from('<< /Type /Pages /Kids [3 0 R] /Count 1 >>'),Buffer.from('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 900 200] /Resources << /XObject << /Img 5 0 R >> >> /Contents 4 0 R >>'),Buffer.from('<< /Length 33 >>\nstream\nq 900 0 0 200 0 0 cm /Img Do Q\nendstream'),Buffer.concat([Buffer.from(`<< /Type /XObject /Subtype /Image /Width 1800 /Height 400 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`),jpeg,Buffer.from('\nendstream')])];
 for(const [i,obj] of objetos.entries()){offsets.push(Buffer.concat(partes).length);partes.push(Buffer.from(`${i+1} 0 obj\n`),obj,Buffer.from('\nendobj\n'));}
 const xref=Buffer.concat(partes).length;
 partes.push(Buffer.from(`xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(n=>String(n).padStart(10,'0')+' 00000 n \n').join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`));
 return Buffer.concat(partes);
}

test.skip(process.env.E2E_LOCAL!=='1','Somente Supabase local, com contas fictícias.');
test('CSP bloqueia injeção e eval e preserva tema, login e navegação autenticada',async({page,request})=>{
 test.setTimeout(180_000);
 const url=process.env.NEXT_PUBLIC_SUPABASE_URL!;
 if(new URL(url).origin!=='http://127.0.0.1:54321')throw new Error('Este teste aceita somente o banco local.');
 const admin=createClient(url,process.env.E2E_LOCAL_SERVICE_ROLE!,{auth:{persistSession:false,autoRefreshToken:false}});
 const email=`csp-${randomUUID()}@example.test`;const password=`Teste-${randomUUID()}`;
 const criado=await admin.auth.admin.createUser({email,password,email_confirm:true});
 if(criado.error||!criado.data.user)throw new Error('Falha criando conta local de teste.');
 try{
  const erros:string[]=[];page.on('pageerror',e=>erros.push(e.message));
  await page.addInitScript(()=>localStorage.setItem('atelie-tema','claro'));
  // Simula markup injetado na resposta, sem conceder privilégios de script
  // confiável ao ataque. strict-dynamic autoriza loaders já confiáveis.
  await page.route('**/login',async route=>{
   const original=await route.fetch();const html=await original.text();
   await route.fulfill({response:original,body:html.replace('</head>','<script data-csp-ataque>window.__cspInjetado=1</script></head>')});
  },{times:1});
  const resposta=await page.goto('/login');
  expect(resposta?.headers()['cache-control']).toContain('no-store');
  const csp=resposta!.headers()['content-security-policy'];
  const scripts=csp.split(';').find(d=>d.trim().startsWith('script-src '))!;
  expect(scripts).not.toMatch(/'unsafe-(?:inline|eval)'/);
  const nonce=/'nonce-([^']+)'/.exec(scripts)![1];
  const nonces=await page.locator('script:not([data-csp-ataque])').evaluateAll(nodes=>nodes.map(n=>(n as HTMLScriptElement).nonce));
  expect(nonces.length).toBeGreaterThan(1);expect(nonces.every(n=>n===nonce)).toBe(true);
  await expect(page.locator('html')).toHaveAttribute('data-tema','claro');
  // Runtime.evaluate do DevTools permite eval por padrão. Disparar por evento
  // real separa o ataque desse privilégio do executor de testes.
  await page.evaluate(()=>{
   const botao=document.createElement('button');botao.id='testar-csp';botao.textContent='Testar bloqueio CSP';
   botao.onclick=()=>{
    const alvo=window as typeof window & {__cspInjetado?:number;__cspBloqueouEval?:boolean};
    alvo.__cspBloqueouEval=false;try{window.eval('window.__cspInjetado=2');}catch{alvo.__cspBloqueouEval=true;}
   };document.body.append(botao);
  });
  await page.getByRole('button',{name:'Testar bloqueio CSP'}).click();
  const ataque=await page.evaluate(()=>{
   const alvo=window as typeof window & {__cspInjetado?:number;__cspBloqueouEval?:boolean};
   document.getElementById('testar-csp')?.remove();return {injetado:alvo.__cspInjetado??null,bloqueouEval:alvo.__cspBloqueouEval};
  });
  expect(ataque).toEqual({injetado:null,bloqueouEval:true});
  const segunda=await request.get('/login',{headers:{'x-nonce':'forjado','Content-Security-Policy':'script-src *'}});
  const nova=segunda.headers()['content-security-policy'];expect(nova).not.toContain(nonce);expect(nova).not.toContain('forjado');expect(nova).not.toContain('script-src *');
  await page.goto('/login/recuperar');await page.getByLabel('E-mail',{exact:true}).fill(email);
  await page.getByRole('button',{name:'Enviar link',exact:true}).click();await expect(page.getByRole('status')).toContainText('receberá um link');
  await page.goto('/login');
  await page.getByLabel('E-mail',{exact:true}).fill(email);await page.getByLabel('Senha',{exact:true}).fill(password);
  await page.getByRole('button',{name:'Entrar',exact:true}).click();await expect(page).toHaveURL(/\/dashboard/);
  const menu=page.getByText('Menu',{exact:true});
  if(await menu.isVisible())await menu.click();
  await page.getByRole('link',{name:'Importar',exact:true}).first().click();await expect(page).toHaveURL(/\/importar/);
  if(await page.locator('details[open]').locator('summary').filter({hasText:'Menu'}).isVisible())await menu.click();
  await expect(page.getByRole('heading',{name:/importar/i}).first()).toBeVisible();
  // Workers do OCR devem ser arquivos públicos, nunca HTML de login.
  const worker=await request.get('/ocr/worker.min.js');expect(worker.status()).toBe(200);expect(worker.headers()['content-type']).toMatch(/javascript/);
  expect(worker.headers()['content-security-policy']).toContain("'wasm-unsafe-eval'");
  const imagem=await page.evaluate(()=>{
   const c=document.createElement('canvas');c.width=1800;c.height=400;const ctx=c.getContext('2d')!;
   ctx.fillStyle='white';ctx.fillRect(0,0,c.width,c.height);ctx.fillStyle='black';ctx.font='48px Arial';
   ctx.fillText('01/10/2026 MERCADO TESTE 123,45 D',50,110);
   return c.toDataURL('image/jpeg',0.95).split(',')[1];
  });
  await page.getByLabel('O que você quer importar?').selectOption('extrato');
  await page.getByLabel('Ler PDF digitalizado com OCR').check();
  await page.getByLabel('Arquivo do extrato (CSV, OFX, OFC, XLSX ou PDF)').setInputFiles({name:'extrato-digitalizado-ficticio.pdf',mimeType:'application/pdf',buffer:pdfComImagem(Buffer.from(imagem,'base64'))});
  await expect(page.getByRole('button',{name:/Importar \d+ transação/})).toBeVisible({timeout:110_000});
  await expect(page.getByText(/MERCADO TESTE/).first()).toBeVisible();
  expect(erros).toEqual([]);
 }finally{
  const removido=await admin.auth.admin.deleteUser(criado.data.user.id);if(removido.error)throw removido.error;
 }
});
