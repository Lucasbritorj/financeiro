import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validarReceita} from '../../src/lib/receita-caixa.ts';
test('recebimento normal aceita apenas dinheiro que entra à vista',()=>{
 for(const forma of ['PIX','TRANSFERENCIA','DINHEIRO'])assert.doesNotThrow(()=>validarReceita(forma,100,'2026-10-20','Observação'));
 for(const forma of ['CREDITO','DEBITO','BOLETO','OUTRO'])assert.throws(()=>validarReceita(forma,100,'2026-10-20',''));
});
test('valida centavos positivos, data e observação limitada',()=>{
 for(const valor of [0,-1,0.5,NaN,Infinity,Number.MAX_SAFE_INTEGER+1])assert.throws(()=>validarReceita('PIX',valor,'2026-10-20',''));
 assert.throws(()=>validarReceita('PIX',1,'2026-02-30',''));
 assert.throws(()=>validarReceita('PIX',1,'2026-10-20','a'.repeat(2001)));
});
