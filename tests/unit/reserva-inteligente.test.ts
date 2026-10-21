import { test } from 'node:test';
import assert from 'node:assert/strict';
import { basesHistoricas, calcularReserva, distribuirReserva, coberturaMes, validarPreferencias, reservadoNoMes } from '../../src/lib/reserva-inteligente.ts';

test('histórico não duplica liquidação/transferência e usa menor receita/maior despesa',()=>{
 const linhas=['2026-07','2026-08','2026-09'].flatMap((mes,i)=>[
  {data_compra:mes+'-01',valor_total:600000+i*100000,tipo:'RECEITA',natureza:'CONSUMO'},
  {data_compra:mes+'-01',valor_total:300000+i*10000,tipo:'DESPESA',natureza:'CONSUMO'},
  {data_compra:mes+'-02',valor_total:900000,tipo:'DESPESA',natureza:'LIQUIDACAO_FATURA'},
  {data_compra:mes+'-02',valor_total:900000,tipo:'RECEITA',natureza:'TRANSFERENCIA'},
 ]);
 assert.deepEqual(basesHistoricas(linhas,['2026-07','2026-08','2026-09']),{receita:600000,gasto:320000});
 assert.deepEqual(basesHistoricas([],['2026-07','2026-08','2026-09']),{receita:0,gasto:0});
});
test('limita reserva por intenção, caixa, margem e despesas sem somar piso novamente',()=>{
 const p={intencao:150000,margem:50000,caixa:200000,compromissos:30000,receita:600000,gasto:430000};
 assert.equal(calcularReserva(p,400000).reserva,120000);
 assert.equal(calcularReserva({...p,caixa:60000},400000).reserva,0);
 assert.equal(calcularReserva({...p,caixa:null},400000).reserva,null);
 assert.equal(calcularReserva({...p,gasto:0},590000).reserva,0);
});
test('distribuição prioriza necessidade e não excede alvos nem orçamento',()=>{
 const metas=[{id:'a',valor_alvo:10000,saldo_atual:0,data_alvo:'2026-11-01',prioridade:1},
 {id:'b',valor_alvo:100000,saldo_atual:0,data_alvo:null,prioridade:2},
 {id:'c',valor_alvo:100,saldo_atual:100,data_alvo:null,prioridade:1}];
 assert.deepEqual(distribuirReserva(15001,metas,'2026-10-19'),[{id:'a',valor:10000},{id:'b',valor:5001},{id:'c',valor:0}]);
 assert.equal(distribuirReserva(999999,metas,'2026-10-19').reduce((a,b)=>a+b.valor,0),110000);
 assert.equal(distribuirReserva(100,[{...metas[0],data_alvo:'2026-09-01'}],'2026-10-19')[0].valor,100);
});
test('cobertura exige contas fechadas desde início e faturas de todos os cartões',()=>{
 const conta={id:'a',nome:'Itaú',data_inicial:'2026-01-01',fechado_ate:'2026-09-30'};
 const cartao={id:'c',nome:'Cartão'};
 assert.equal(coberturaMes('2026-09',[conta],[cartao],[{cartao_id:'c',competencia:'2026-09-01'}],[]).completo,true);
 for(const [contas,cartoes,lotes,pendentes] of [
  [[],[],[],[]],[[{...conta,data_inicial:'2026-09-02'}],[cartao],[{cartao_id:'c',competencia:'2026-09-01'}],[]],
  [[conta],[cartao],[],[]],[[conta],[cartao],[{cartao_id:'c',competencia:'2026-09-01'}],[{conta_id:'a',data:'2026-09-02'}]],
 ] as const) assert.equal(coberturaMes('2026-09',contas,cartoes,lotes,pendentes).completo,false);
});
test('preferências validam centavos, limites, prioridades e campos desconhecidos',()=>{
 const p={intencao:0,margem:0,caixa:null,compromissos:0,receita:null,gasto:null,prioridades:{}};
 assert.deepEqual(validarPreferencias(p),p);
 for(const x of [{intencao:-1},{margem:0.5},{caixa:Number.MAX_SAFE_INTEGER},{receita:'12'},{prioridades:{x:0}},{extra:true}])assert.throws(()=>validarPreferencias({...p,...x}));
 assert.throws(()=>calcularReserva({...p,receita:1,gasto:0,intencao:-1},0));
});

test('aportes já feitos reduzem intenção e capacidade mensal, sem sugerir repetição',()=>{
 const p={intencao:150000,margem:50000,caixa:900000,compromissos:0,receita:600000,gasto:430000};
 assert.equal(calcularReserva(p,0,100000).reserva,20000);
 assert.equal(calcularReserva(p,0,150000).reserva,0);
});
test('total mensal inclui movimentos de cofrinhos arquivados e respeita data/resgates',()=>{
 const movimentos=[...Array.from({length:1001},()=>({data:'2026-10-01',valor:100,tipo:'APORTE',cofrinho_id:'arquivado'})),{data:'2026-09-01',valor:990000,tipo:'APORTE'}, {data:'2026-10-20',valor:990000,tipo:'APORTE'}, {data:'2026-10-02',valor:100,tipo:'RESGATE'}];
 assert.equal(reservadoNoMes(movimentos,'2026-10-19'),100000);
});
