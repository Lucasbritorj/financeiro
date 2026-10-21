import {randomBytes,createCipheriv,createDecipheriv,publicEncrypt,privateDecrypt,constants} from 'node:crypto';
import {gzipSync,gunzipSync} from 'node:zlib';
const assinatura=Buffer.from('FINANCEIRO-BACKUP-1\n');
/** AES-256-GCM autentica o conteúdo; RSA-OAEP protege a chave de cada cópia. */
export function criptografarCopia(conteudo,chavePublica){
 const chave=randomBytes(32),iv=randomBytes(12);const c=createCipheriv('aes-256-gcm',chave,iv);c.setAAD(assinatura);
 const dados=Buffer.concat([c.update(gzipSync(conteudo)),c.final()]);
 const envelope=Buffer.from(JSON.stringify({chave:publicEncrypt({key:chavePublica,oaepHash:'sha256',padding:constants.RSA_PKCS1_OAEP_PADDING},chave).toString('base64'),iv:iv.toString('base64'),tag:c.getAuthTag().toString('base64')}));
 const tamanho=Buffer.alloc(4);tamanho.writeUInt32BE(envelope.length);chave.fill(0);
 return Buffer.concat([assinatura,tamanho,envelope,dados]);
}
export function abrirCopia(copia,chavePrivada){
 if(!copia.subarray(0,assinatura.length).equals(assinatura)||copia.length<assinatura.length+4)throw new Error('Cópia inválida.');
 const n=copia.readUInt32BE(assinatura.length);if(n>16384||n<1||assinatura.length+4+n>=copia.length)throw new Error('Envelope inválido.');
 const inicio=assinatura.length+4,e=JSON.parse(copia.subarray(inicio,inicio+n));
 const chave=privateDecrypt({key:chavePrivada,oaepHash:'sha256',padding:constants.RSA_PKCS1_OAEP_PADDING},Buffer.from(e.chave,'base64'));
 try{const d=createDecipheriv('aes-256-gcm',chave,Buffer.from(e.iv,'base64'));d.setAAD(assinatura);d.setAuthTag(Buffer.from(e.tag,'base64'));return gunzipSync(Buffer.concat([d.update(copia.subarray(inicio+n)),d.final()]),{maxOutputLength:512*1024*1024});}
 finally{chave.fill(0);}
}
