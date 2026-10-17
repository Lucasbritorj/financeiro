import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync,spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';

// Alvo fixo local. Não aceita URL/chave de ambiente nem usa dados reais.
const args=['exec','-i','supabase_db_financeiro-web','psql','-U','postgres','-d','postgres','-At','-q','-v','ON_ERROR_STOP=1'];
const sql=entrada=>execFileSync('docker',args,{input:entrada,encoding:'utf8',timeout:15000,stdio:['pipe','pipe','pipe']});
const claims=u=>`select set_config('request.jwt.claims','{"sub":"${u}"}',true);`;

for(const operacao of ['reversão','pagamento'])test(`concorrência real: ${operacao} simultânea à reversão mantém integridade`,{timeout:30000},async()=>{
 const u=randomUUID(),lote=randomUUID();let processo,terminou;
 sql(`insert into auth.users(id,email) values('${u}','${u}@concorrencia.local.test');`);
 try {
  const cartao=sql(`begin;${claims(u)}select public.criar_cartao('Cartão concorrência',100000,20,8)->>'cartao_id';commit;`).trim().split('\n').at(-1);
  assert.match(cartao,/^[a-f0-9-]{36}$/);
  sql(`begin;${claims(u)}select public.confirmar_fatura_importada('${lote}',null,'${cartao}','2030-10-01','PDF','[{"data":"2030-10-01","descricao":"CONCORRENCIA FICTICIA","valor":1000,"tipo":"GASTO"}]',1000,false);commit;`);
  const token=sql(`begin;${claims(u)}select public.consultar_reversao_importacao('FATURA','${lote}')->>'token';commit;`).trim().split('\n').at(-1);
  assert.match(token,/^[a-f0-9]{32}$/);
  const reverter=`select public.desfazer_importacao('FATURA','${lote}','${token}');`;
  const primeira=operacao==='reversão'?reverter:`select public.processar_pagamento_fatura((select id from public.faturas where cartao_id='${cartao}'),now());`;
  processo=spawn('docker',args);let stdout='',stderr='';
  terminou=new Promise((resolve,reject)=>{processo.once('error',reject);processo.once('close',c=>c===0?resolve():reject(new Error(stderr)));});
  processo.stderr.on('data',c=>stderr+=c);
  const travado=new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>reject(new Error('Operação não atingiu trava.')),10000);
   processo.stdout.on('data',c=>{stdout+=c;if(stdout.includes('TRAVADO')){clearTimeout(timer);resolve();}});
   processo.once('close',()=>{clearTimeout(timer);if(!stdout.includes('TRAVADO'))reject(new Error(stderr));});
  });
  processo.stdin.end(`begin;${claims(u)}${primeira}select 'TRAVADO';select pg_sleep(2);commit;`);
  await travado;
  if(operacao==='reversão')assert.match(sql(`begin;${claims(u)}${reverter}commit;`),/"repetida": true/);
  else assert.throws(()=>sql(`begin;${claims(u)}${reverter}commit;`),/pagamento|fechada|paga/i);
  await terminou;
  assert.equal(sql(`select count(*) from public.reversoes_importacao where user_id='${u}';`).trim(),operacao==='reversão'?'1':'0');
  assert.equal(sql(`select count(*) from public.transacoes_origem where user_id='${u}' and deleted_at is null;`).trim(),operacao==='reversão'?'0':'1');
  if(operacao==='pagamento')assert.equal(sql(`select status from public.faturas where cartao_id='${cartao}';`).trim(),'PAGA');
 }finally {
  if(processo&&processo.exitCode===null){processo.kill();await terminou?.catch(()=>{});}
  sql(`delete from auth.users where id='${u}';`);
 }
});
