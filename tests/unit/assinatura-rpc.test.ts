import {test} from 'node:test';
import assert from 'node:assert/strict';
import {gerarAssinaturaRpc} from '../../src/lib/assinatura-rpc.ts';
test('assinatura não contém chave e muda por titular, operação e instante',()=>{
 const chave='a'.repeat(64),tempo=1_792_000_000;
 const a=gerarAssinaturaRpc(chave,'titular','criar_importacao',tempo);
 assert.equal(a['x-financeiro-tempo'],String(tempo));assert.match(a['x-financeiro-assinatura'],/^[a-f0-9]{64}$/);assert.notEqual(a['x-financeiro-assinatura'],chave);
 for(const b of [gerarAssinaturaRpc(chave,'outro','criar_importacao',tempo),gerarAssinaturaRpc(chave,'titular','confirmar_importacao',tempo),gerarAssinaturaRpc(chave,'titular','criar_importacao',tempo+1)])assert.notDeepEqual(a,b);
 assert.throws(()=>gerarAssinaturaRpc(undefined,'titular','criar_importacao',tempo));
});
