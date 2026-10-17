import { test } from 'node:test';
import assert from 'node:assert/strict';
import { montarPlanejamento, gerarAlertas, type AssinaturaPlanejamento } from '../../src/lib/planejamento.ts';

const cartao = { id: 'c', nome: 'Cartão fictício', dia_fechamento: 28 };
const assinatura: AssinaturaPlanejamento = { id: 'a', descricao: 'Serviço fictício', valor: 3000, periodicidade: 'MENSAL', status: 'ATIVA', proxima_data: '2026-01-31', dia_do_mes: 31, cartao_id: 'c' };
const base = { mes: '2026-01', cartoes: [cartao], parcelas: [], previsoes: [], assinaturas: [], cobrancas: [] };

test('CA3: 12 meses, ano seguinte e centavos separados sem alterar entradas', () => {
 const args = { ...base, mes: '2026-12', parcelas: [{id:'p',cartao_id:'c',competencia:'2026-12-01',valor:1234}], previsoes:[{id:'v',cartao_id:'c',competencia:'2026-12-01',valor:2001}] };
 const antes = JSON.stringify(args); const meses = montarPlanejamento(args);
 assert.equal(meses.length,12); assert.equal(meses[11].mes,'2027-11');
 assert.deepEqual(meses[0].cartoes[0], { id:'c',nome:cartao.nome,registrado:1234,parcelasPrevistas:2001,assinaturasPrevistas:0,comprometido:3235 });
 assert.equal(JSON.stringify(args),antes);
});
test('CA4: dia 31 é ancorado, fechamento muda competência e mês confirmado não duplica assinatura',()=>{
 const meses=montarPlanejamento({...base,assinaturas:[assinatura],cobrancas:[{id:'ci',assinatura_id:'a',cartao_id:'c',competencia:'2026-02-01',valor:3000,data:'2026-01-31'}]});
 assert.equal(meses[0].cartoes[0].assinaturasPrevistas,0);
 assert.equal(meses[1].cartoes[0].assinaturasPrevistas,0);
 assert.equal(meses[2].cartoes[0].assinaturasPrevistas,3000);
 assert.equal(meses[3].cartoes[0].assinaturasPrevistas,3000);
});
test('CA4: ciclos reais, pausadas e canceladas, sem cartão em grupo próprio',()=>{
 const meses=montarPlanejamento({...base,assinaturas:[
 {...assinatura,proxima_data:'2026-01-10',periodicidade:'TRIMESTRAL',cartao_id:null},
 {...assinatura,id:'b',status:'PAUSADA'}, {...assinatura,id:'d',status:'CANCELADA'},
 ]});
 assert.equal(meses[0].semCartao,3000); assert.equal(meses[1].semCartao,0); assert.equal(meses[3].semCartao,3000);
 assert.equal(meses.reduce((s,m)=>s+m.semCartao,0),12000);
 assert.equal(meses.reduce((s,m)=>s+m.cartoes[0].comprometido,0),0);
});
test('CA4: ciclos anual e semestral não viram despesas mensais',()=>{
 const meses=montarPlanejamento({...base,assinaturas:[{...assinatura,proxima_data:'2026-01-10',dia_do_mes:10,periodicidade:'ANUAL'}, {...assinatura,id:'b',proxima_data:'2026-01-10',dia_do_mes:10,periodicidade:'SEMESTRAL'}]});
 assert.equal(meses[0].cartoes[0].assinaturasPrevistas,6000);assert.equal(meses[1].cartoes[0].assinaturasPrevistas,0);assert.equal(meses[6].cartoes[0].assinaturasPrevistas,3000);
});
test('CA3: mês inválido rejeitado e conta vazia tem 12 meses zerados',()=>{
 assert.throws(()=>montarPlanejamento({...base,mes:'2026-99'}));
 assert.equal(montarPlanejamento({...base,cartoes:[]})[0].total,0);
});
test('CA11: soma fora da precisão de centavos é recusada em vez de exibir valor arredondado',()=>{
 const parcelas=Array.from({length:10000},(_,i)=>({id:String(i),cartao_id:'c',competencia:'2026-01-01',valor:999999999999}));
 assert.throws(()=>montarPlanejamento({...base,parcelas}),/precisão|limite/i);
});
test('CA8: vencidos e até sete dias, sem declarar assinatura como dívida',()=>{
 const alertas=gerarAlertas({hoje:'2026-10-17',assinaturas:[{...assinatura,proxima_data:'2026-10-24'}],cobrancas:[],contas:[
 {id:'x',descricao:'Conta fictícia',valor:100,data_vencimento:'2026-10-16'}, {id:'y',descricao:'Depois',valor:200,data_vencimento:'2026-10-25'}]});
 assert.equal(alertas.length,2); assert.ok(alertas.some(a=>a.tipo==='VENCIMENTO'&&a.atrasado));
 assert.ok(alertas.some(a=>a.tipo==='ASSINATURA'&&a.href==='/assinaturas')); assert.ok(!JSON.stringify(alertas).includes('inadimplente'));
});
test('CA9: compara último mês ao anterior, não valores dentro do mesmo mês',()=>{
 const ci=(id:string,competencia:string,valor:number)=>({id,competencia,valor,assinatura_id:'a',cartao_id:'c',data:competencia});
 const alertas=gerarAlertas({hoje:'2026-10-17',assinaturas:[{...assinatura,proxima_data:'2026-12-01'}],contas:[],cobrancas:[ci('1','2026-08-01',3000),ci('2','2026-09-01',3500),ci('3','2026-09-01',3500)]});
 const aumento=alertas.filter(a=>a.tipo==='AUMENTO'); assert.equal(aumento.length,1); assert.equal(aumento[0].valor,7000);
 assert.equal(gerarAlertas({hoje:'2026-10-17',assinaturas:[assinatura],contas:[],cobrancas:[ci('1','2026-09-01',3000),ci('2','2026-09-01',3500)]}).filter(a=>a.tipo==='AUMENTO').length,0);
});
test('CA9: nome normalizado e mesmo cartão sinalizam possível contrato duplicado, sem mutação',()=>{
 const assinaturas=[assinatura,{...assinatura,id:'b',descricao:'  SERVIÇO   FICTÍCIO  '},{...assinatura,id:'d',cartao_id:'outro'},{...assinatura,id:'e',status:'CANCELADA' as const}];
 const antes=JSON.stringify(assinaturas);
 const alertas=gerarAlertas({hoje:'2026-10-17',assinaturas,cobrancas:[],contas:[]});
 assert.equal(alertas.filter(a=>a.tipo==='DUPLICIDADE').length,1);assert.equal(JSON.stringify(assinaturas),antes);
});
