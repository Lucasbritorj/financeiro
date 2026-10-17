import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync,spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
// Alvo fixo local; não aceita credenciais ou URL remota.
const args=['exec','-i','supabase_db_financeiro-web','psql','-U','postgres','-d','postgres','-At','-q','-v','ON_ERROR_STOP=1'];
const sql=s=>execFileSync('docker',args,{input:s,encoding:'utf8',timeout:15000});
const claims=u=>`select set_config('request.jwt.claims','{"sub":"${u}"}',true);`;
test('dois envios concorrentes da mesma fatura geram uma cobrança e um plano',{timeout:30000},async()=>{
 const u=randomUUID(), chave=randomUUID();let primeiro,concluido;
 sql(`insert into auth.users(id,email) values('${u}','${u}@concorrencia.local.test');`);
 try {
  const cartao=sql(`begin;${claims(u)}select public.criar_cartao('Concorrência fatura',100000,20,10)->>'cartao_id';commit;`).trim().split('\n').at(-1);
  assert.match(cartao,/^[a-f0-9-]{36}$/);
  const chamada=`select public.confirmar_fatura_importada('${chave}',null,'${cartao}','2026-10-01','PDF','[{"data":"2026-10-05","descricao":"MOVEIS 03/10","valor":10000,"tipo":"PARCELA","parcela_numero":3,"parcelas_total":10}]',null,true);`;
  primeiro=spawn('docker',args);let out='',err='';
  concluido=new Promise((resolve,reject)=>{primeiro.once('error',reject);primeiro.once('close',c=>c===0?resolve():reject(new Error(err)));});
  primeiro.stderr.on('data',c=>err+=c);
  const travado=new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>reject(new Error('Sessão não atingiu trava.')),10000);
   primeiro.stdout.on('data',c=>{out+=c;if(out.includes('TRAVADO')){clearTimeout(timer);resolve();}});
   primeiro.once('close',()=>{clearTimeout(timer);if(!out.includes('TRAVADO'))reject(new Error(err));});
  });
  primeiro.stdin.end(`begin;${claims(u)}${chamada}select 'TRAVADO';select pg_sleep(2);commit;`);
  await travado;
  const repetida=sql(`begin;${claims(u)}${chamada}commit;`);
  assert.match(repetida,/"repetida": true/);await concluido;
  assert.equal(sql(`select count(*) from public.transacoes_origem where user_id='${u}';`).trim(),'1');
  assert.equal(sql(`select count(*) from public.planos_parcelamento where user_id='${u}';`).trim(),'1');
  assert.equal(sql(`select count(*) from public.vw_previsoes_parcelamento where user_id='${u}';`).trim(),'7');
 }finally{
  if(primeiro&&primeiro.exitCode===null){primeiro.kill();await concluido?.catch(()=>{});}
  sql(`delete from auth.users where id='${u}';`);
 }
});
