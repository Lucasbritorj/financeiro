import {test} from 'node:test';
import assert from 'node:assert/strict';
import {normalizarTransacaoPluggy,lerTransacoesPluggy} from '../../src/lib/pluggy.ts';
const id='00000000-0000-0000-0000-000000000001';
const base={id,accountId:id,date:'2026-10-10T12:00:00.000Z',amount:-12.34,currencyCode:'BRL',description:'MERCADO TESTE',status:'POSTED',type:'DEBIT',providerId:'banco-1'};
test('Pluggy converte centavos, preserva ID do banco e ignora agendamento',()=>{
 const r=normalizarTransacaoPluggy(base,id)!;
 assert.equal(r.valor,-1234);assert.equal(r.data,'2026-10-10');assert.equal(r.id_externo,'banco-1');
 assert.equal(normalizarTransacaoPluggy({...base,status:'PENDING'},id),null);
 assert.throws(()=>normalizarTransacaoPluggy({...base,currencyCode:'USD'},id));
 assert.throws(()=>normalizarTransacaoPluggy({...base,accountId:'outra'},id));
 assert.throws(()=>normalizarTransacaoPluggy({...base,amount:12.34},id));
});
test('Pluggy pagina por cursor, mantém filtro e recusa cursor repetido',async()=>{
 const urls:string[]=[];
 const fetcher:typeof fetch=async(url)=>{urls.push(String(url));return Response.json(urls.length===1?{results:[base],next:'?accountId='+id+'&after=pagina2'}:{results:[{...base,id:'outro',providerId:'banco-2'}],next:null});};
 const r=await lerTransacoesPluggy('chave-ficticia',id,'2026-10-01','2026-10-31',fetcher);
 assert.equal(r.linhas.length,2);assert.match(urls[1],/after=pagina2/);assert.match(urls[1],/dateFrom=/);
 await assert.rejects(()=>lerTransacoesPluggy('chave-ficticia',id,'2026-10-01','2026-10-31',async()=>Response.json({results:[],next:'?after=igual'})),/avançou/);
});
test('falha de dependência não vira lista vazia',async()=>{
 await assert.rejects(()=>lerTransacoesPluggy('chave-ficticia',id,'2026-10-01','2026-10-31',async()=>new Response('indisponível',{status:503})),/indisponível/);
});
