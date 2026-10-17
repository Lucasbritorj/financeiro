import lighthouse from 'lighthouse';
import {launch} from 'chrome-launcher';
import {chromium} from '@playwright/test';
import {writeFile,rm,mkdir} from 'node:fs/promises';
import {resolve,dirname,join,sep} from 'node:path';

// Cookies somente de usuário temporário local, recebidos na memória, nunca pela linha de comando.
const alvo=new URL(process.argv[2]);const relatorio=resolve(process.argv[3]);
if(alvo.origin!=='http://127.0.0.1:3100'||!relatorio.startsWith(resolve('test-results')+sep))throw new Error('Auditoria aceita somente rota e artefato locais.');
const perfil=join(dirname(relatorio),'chrome-profile-lighthouse');
let entrada='';for await(const parte of process.stdin)entrada+=parte;
let chrome,browser;
try {
 await mkdir(perfil,{recursive:true});
 chrome=await launch({chromeFlags:['--headless=new','--disable-gpu','--no-sandbox'],userDataDir:perfil});
 browser=await chromium.connectOverCDP(`http://127.0.0.1:${chrome.port}`);
 await browser.contexts()[0].addCookies(JSON.parse(entrada));
 const resultado=await lighthouse(alvo.href,{port:chrome.port,output:'json',onlyCategories:['performance','accessibility'],disableStorageReset:true,logLevel:'error'});
 if(resultado.lhr.runtimeError||!resultado.lhr.finalDisplayedUrl.startsWith(alvo.origin+'/planejamento'))throw new Error('Lighthouse não alcançou a rota autenticada.');
 await writeFile(relatorio,resultado.report);
 const scores={desempenho:Math.round(resultado.lhr.categories.performance.score*100),acessibilidade:Math.round(resultado.lhr.categories.accessibility.score*100)};
 console.log(JSON.stringify(scores));
 if(scores.desempenho<90||scores.acessibilidade<100)process.exitCode=1;
}finally {
 await browser?.close().catch(()=>{});await chrome?.kill();
 await rm(perfil,{recursive:true,force:true,maxRetries:5,retryDelay:100});
}
