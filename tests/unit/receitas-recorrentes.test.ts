import {test} from 'node:test';
import assert from 'node:assert/strict';
import {dataDaParte,validarPartes} from '../../src/lib/receitas-recorrentes.ts';
test('dias contratados sobrevivem a fevereiro sem saltar para março',()=>{
 assert.equal(dataDaParte('2027-02',30),'2027-02-28');
 assert.equal(dataDaParte('2028-02',30),'2028-02-29');
 assert.equal(dataDaParte('2028-03',30),'2028-03-30');
 assert.equal(dataDaParte('2026-04',31),'2026-04-30');
 assert.throws(()=>dataDaParte('2026-13',30));assert.throws(()=>dataDaParte('2026-02',0));
});
test('partes distintas em dias15 e30 com valores positivos, limitados e sem duplicidade',()=>{
 assert.doesNotThrow(()=>validarPartes([{dia:15,valor:10000},{dia:30,valor:20000}]));
 for(const partes of [[],[{dia:15,valor:0}],[{dia:15,valor:1},{dia:15,valor:2}],[{dia:32,valor:1}],[{dia:1,valor:1.5}]])assert.throws(()=>validarPartes(partes));
});
