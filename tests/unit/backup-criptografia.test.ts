import {test} from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync} from 'node:crypto';
import {criptografarCopia,abrirCopia} from '../../scripts/backup-criptografia.mjs';
const chaves=generateKeyPairSync('rsa',{modulusLength:2048});
test('cópia protege conteúdo e restaura bytes com a chave privada',()=>{
 const dados=Buffer.from('dados financeiros sintéticos sem informações reais');
 const copia=criptografarCopia(dados,chaves.publicKey);
 assert.equal(copia.includes(dados),false);assert.deepEqual(abrirCopia(copia,chaves.privateKey),dados);
});
test('cópia adulterada e outra chave não passam na autenticação',()=>{
 const copia=criptografarCopia(Buffer.from('fixture'),chaves.publicKey);copia[copia.length-1]^=1;
 assert.throws(()=>abrirCopia(copia,chaves.privateKey));
 const outra=generateKeyPairSync('rsa',{modulusLength:2048});
 assert.throws(()=>abrirCopia(criptografarCopia(Buffer.from('fixture'),chaves.publicKey),outra.privateKey));
});
