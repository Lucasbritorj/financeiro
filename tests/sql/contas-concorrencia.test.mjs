import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync,spawn} from 'node:child_process';
import {readFileSync,readdirSync} from 'node:fs';
import {randomUUID} from 'node:crypto';

// Exclusivamente Postgres descartável, sem rede e sem banco de produção.
let container;
const uid=randomUUID(),outro=randomUUID();let origem,destino;
function args(){return ['exec','-i',container,'psql','-U','postgres','-d','app','-Atq','-v','ON_ERROR_STOP=1'];}
function sql(text){return execFileSync('docker',args(),{input:text,encoding:'utf8',timeout:20_000,maxBuffer:4_000_000}).trim();}
function claims(id=uid){return `set local request.jwt.claims='{"sub":"${id}"}';`;}
function consulta(text){return sql(`begin;${claims()}${text};commit;`);}
function paralelo(text){return new Promise((resolve,reject)=>{
 const p=spawn('docker',args());let saida='',erro='';p.stdout.on('data',c=>saida+=c);p.stderr.on('data',c=>erro+=c);
 const timer=setTimeout(()=>{p.kill();reject(new Error('Timeout em teste concorrente local.'));},20_000);
 p.once('error',e=>{clearTimeout(timer);reject(e);});p.once('close',code=>{clearTimeout(timer);code===0?resolve(saida.trim()):reject(new Error(erro));});
 p.stdin.end(`begin;${claims()}${text};commit;`);
});}
before(async()=>{
 container=execFileSync('docker',['run','-d','--network','none','-e','POSTGRES_PASSWORD=test','-e','POSTGRES_DB=app','postgres:17-alpine'],{encoding:'utf8'}).trim();
 assert.match(container,/^[a-f0-9]{64}$/);
 // O entrypoint inicia um servidor temporário antes do Postgres definitivo.
 // pg_isready sozinho pode responder durante esse estágio e a migração cair no shutdown.
 for(let i=0;i<60;i++){try{execFileSync('docker',['exec',container,'sh','-c','test "$(cat /proc/1/comm)" = postgres && pg_isready -U postgres -d app'],{stdio:'ignore'});break;}catch{if(i===59)throw new Error('Banco descartável não iniciou.');await new Promise(r=>setTimeout(r,250));}}
 sql(readFileSync('tests/sql/00_shim_auth.sql','utf8'));
 for(const file of readdirSync('supabase/migrations').filter(f=>f.endsWith('.sql')).sort())sql(readFileSync(`supabase/migrations/${file}`,'utf8'));
 sql(`insert into auth.users(id) values('${uid}'),('${outro}');`);
 origem=consulta("select public.criar_conta_bancaria('Origem fictícia',100000,'2026-01-01')->>'id'");
 destino=consulta("select public.criar_conta_bancaria('Destino fictício',0,'2026-01-01')->>'id'");
});
after(()=>{if(container&&/^[a-f0-9]{64}$/.test(container))execFileSync('docker',['rm','-f',container],{stdio:'ignore'});});
test('duas transferências simultâneas com mesma chave geram somente um par',async()=>{
 const chave=randomUUID();const q=`select public.transferir_entre_contas('${origem}','${destino}',1000,'2026-01-02','${chave}')`;
 await Promise.all([paralelo(q),paralelo(q)]);
 assert.equal(sql(`select count(*) from public.movimentos_conta where transferencia_id='${chave}'`),'2');
 assert.equal(sql(`select sum(valor) from public.movimentos_conta where transferencia_id='${chave}'`),'0');
});
test('transferências em sentidos opostos respeitam ordem estável de travas',async()=>{
 await Promise.all([paralelo(`select public.transferir_entre_contas('${origem}','${destino}',500,'2026-01-03','${randomUUID()}')`),paralelo(`select public.transferir_entre_contas('${destino}','${origem}',500,'2026-01-03','${randomUUID()}')`)]);
 assert.equal(sql(`select sum(valor) from public.movimentos_conta where user_id='${uid}'`),'0');
});
test('duas confirmações concorrentes da mesma linha não duplicam gasto',async()=>{
 consulta(`select public.importar_extrato_conta('${origem}','OFX','[{"data":"2026-01-04","valor":-100,"descricao":"Compra fictícia","id_externo":"csp-teste"}]')`);
 const linha=sql(`select id from public.linhas_extrato_conta where conta_id='${origem}' and id_externo='csp-teste'`);
 const q=`select public.conciliar_linha_conta('${linha}','NOVA',null,null,null)`;
 const resultados=await Promise.allSettled([paralelo(q),paralelo(q)]);
 assert.ok(resultados.some(r=>r.status==='fulfilled'));
 assert.equal(sql(`select count(*) from public.transacoes_origem where user_id='${uid}' and deleted_at is null`),'1');
 assert.equal(sql(`select count(*) from public.movimentos_conta where user_id='${uid}' and transacao_id is not null`),'1');
});
test('outro titular não lê tabelas nem chama RPC de conta alheia',()=>{
 const total=sql(`begin;set local role authenticated;${claims(outro)}select (select count(*) from public.contas_bancarias)+(select count(*) from public.movimentos_conta)+(select count(*) from public.linhas_extrato_conta)+(select count(*) from public.historico_conciliacao);rollback;`);
 assert.equal(total,'0');
 assert.throws(()=>sql(`begin;${claims(outro)}select public.consultar_conta_bancaria('${origem}','2026-01-01','2026-01-31');rollback;`),/Conta não encontrada/);
});
test('cota de servidor é atômica entre chamadas concorrentes',async()=>{
 const chave=randomUUID().replaceAll('-','').repeat(2);
 const janela=sql("select floor(extract(epoch from clock_timestamp())/3600)");
 const respostas=await Promise.all(Array.from({length:12},()=>paralelo(`select public.consumir_limite_servidor('${chave}','cadastrar')`)));
 const mesmaJanela=janela===sql("select floor(extract(epoch from clock_timestamp())/3600)");
 if(mesmaJanela){
  assert.equal(respostas.filter(r=>JSON.parse(r).permitido).length,3);
  assert.equal(sql(`select total from public.limites_servidor where chave='${chave}' and acao='cadastrar'`),'4');
 }
 assert.ok(respostas.every(r=>typeof JSON.parse(r).permitido==='boolean'));
});

function ocorrenciasSalario(descricao){
 consulta(`select public.criar_receitas_previstas('${randomUUID()}','${descricao}','PIX','2026-01-01','[{"dia":15,"valor":1000},{"dia":30,"valor":2000}]',null);select public.consultar_receitas_previstas('2026-01-01')`);
 return sql(`select array_agg(id order by id)::text from public.ocorrencias_receita where user_id='${uid}' and descricao='${descricao}'`);
}
test('receita recorrente: duas abas repetindo mesma confirmação criam uma entrada',async()=>{
 const ids=ocorrenciasSalario('Salario concorrente mesma chave');const chave=randomUUID();
 const q=`select public.confirmar_receitas_previstas('${chave}','${ids}','2026-01-10',3000,null)`;
 await Promise.all([paralelo(q),paralelo(q)]);
 assert.equal(sql(`select count(*) from public.confirmacoes_receita where user_id='${uid}' and chave='${chave}'`),'1');
 assert.equal(sql(`select count(distinct transacao_id) from public.ocorrencias_receita where id=any('${ids}'::uuid[])`),'1');
});
test('receita recorrente: chaves distintas disputando as mesmas partes não duplicam renda',async()=>{
 const ids=ocorrenciasSalario('Salario concorrente chaves diferentes');
 const rs=await Promise.allSettled([paralelo(`select public.confirmar_receitas_previstas('${randomUUID()}','${ids}','2026-01-10',3000,null)`),paralelo(`select public.confirmar_receitas_previstas('${randomUUID()}','${ids}','2026-01-10',3000,null)`)]);
 assert.equal(rs.filter(r=>r.status==='fulfilled').length,1);assert.equal(rs.filter(r=>r.status==='rejected').length,1);
 assert.equal(sql(`select count(distinct transacao_id) from public.ocorrencias_receita where id=any('${ids}'::uuid[]) and status='RECEBIDA'`),'1');
});
test('receita recorrente: pular e confirmar em paralelo preservam um único estado financeiro',async()=>{
 const ids=ocorrenciasSalario('Salario concorrente pulo');const id=sql(`select id from public.ocorrencias_receita where id=any('${ids}'::uuid[]) order by id limit 1`);
 const rs=await Promise.allSettled([paralelo(`select public.confirmar_receitas_previstas('${randomUUID()}',array['${id}'::uuid],'2026-01-10',1000,null)`),paralelo(`select public.marcar_receita_nao_recebida('${id}',true,null)`)]);
 assert.equal(rs.filter(r=>r.status==='fulfilled').length,1);
 assert.equal(sql(`select ((status='PULADA' and transacao_id is null) or (status='RECEBIDA' and transacao_id is not null))::text from public.ocorrencias_receita where id='${id}'`),'true');
});

function prepararRegra(descricao){
 const cat=consulta(`select public.criar_categoria('${descricao}',null,null,'DESPESA')->>'categoria_id'`);
 const tx=consulta(`select public.processar_transacao_completa('${descricao}',100,'DESPESA','PIX',null,'2026-01-10',1)->>'transacao_id'`);
 const versao=consulta(`select public.consultar_previa_regra('${tx}','${cat}','${descricao}',100)->>'versao'`);
 return {cat,tx,versao};
}

test('regra pessoal: mesma chave simultânea cria uma regra e uma confirmação',async()=>{
 const descricao='LOJA TESTE CONCORRENTE REPETICAO';const {cat,tx,versao}=prepararRegra(descricao);const chave=randomUUID();
 const q=`select public.salvar_regra_pessoal('${chave}','${tx}','${cat}','${descricao}',100,'${versao}')`;
 await Promise.all([paralelo(q),paralelo(q)]);
 assert.equal(sql(`select count(*) from public.regras_categorizacao where user_id='${uid}' and padrao='${descricao}'`),'1');
 assert.equal(sql(`select count(*) from public.tentativas_regra_pessoal where user_id='${uid}' and chave='${chave}'`),'1');
 assert.equal(sql(`select categoria_id from public.transacoes_origem where id='${tx}'`),cat);
});

test('regra pessoal: duas chaves com prévia antiga exigem revisar a segunda aba',async()=>{
 const descricao='LOJA TESTE CONCORRENTE VERSAO';const {cat,tx,versao}=prepararRegra(descricao);
 const q=chave=>`select public.salvar_regra_pessoal('${chave}','${tx}','${cat}','${descricao}',100,'${versao}')`;
 const rs=await Promise.allSettled([paralelo(q(randomUUID())),paralelo(q(randomUUID()))]);
 assert.equal(rs.filter(r=>r.status==='fulfilled').length,1);assert.equal(rs.filter(r=>r.status==='rejected').length,1);
 assert.equal(sql(`select count(*) from public.regras_categorizacao where user_id='${uid}' and padrao='${descricao}'`),'1');
});

test('snapshot de caixa e eventos conserva receita durante confirmação concorrente',async()=>{
 const descricao='RECEITA SNAPSHOT CONCORRENTE';
 consulta(`select public.criar_receitas_previstas('${randomUUID()}','${descricao}','PIX','2026-01-01','[{"dia":15,"valor":1000}]',null);select public.consultar_receitas_previstas('2026-01-01')`);
 const ids=sql(`select array_agg(id)::text from public.ocorrencias_receita where user_id='${uid}' and descricao='${descricao}'`);
 const esperado=Number(consulta("select public.consultar_eventos_caixa('2026-01-01')->>'caixa'"))+1000;
 function total(){const p=JSON.parse(consulta("select public.consultar_eventos_caixa('2026-01-01')"));return p.caixa+p.eventos.filter(e=>e.descricao===descricao&&e.data==='2026-01-15').reduce((s,e)=>s+e.valor,0);}
 const confirmacao=paralelo(`select public.confirmar_receitas_previstas('${randomUUID()}','${ids}','2026-01-10',1000,null);select pg_sleep(0.5)`);
 for(let i=0;i<3;i++)assert.equal(total(),esperado);
 await confirmacao;assert.equal(total(),esperado);
});
