import {test} from 'node:test';
import assert from 'node:assert/strict';
import {candidatosParaLinha} from '../../src/lib/conciliacao-bancaria.ts';
test('candidatos respeitam sinal, centavos e janela sem escolher entre compras iguais',()=>{
 const base={id:'1',data_compra:'2026-10-03',descricao:'Mercado',valor_total:1000,tipo:'DESPESA',natureza:'CONSUMO'};
 const candidatos=[base,{...base,id:'2'},{...base,id:'3',tipo:'RECEITA'},{...base,id:'4',valor_total:1001},{...base,id:'5',data_compra:'2026-10-10'}];
 assert.deepEqual(candidatosParaLinha({data:'2026-10-03',valor:-1000},candidatos).map(t=>t.id),['1','2']);
});
