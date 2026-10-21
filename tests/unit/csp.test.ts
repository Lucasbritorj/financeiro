import { test } from 'node:test';
import assert from 'node:assert/strict';
import { criarNonce, criarPoliticaScripts } from '../../src/lib/csp.ts';

test('produção exige nonce sem autorizar scripts inline genéricos ou eval', () => {
 const csp=criarPoliticaScripts(criarNonce(),'https://exemplo.supabase.co',false);
 const scripts=csp.split(';').find(d=>d.trim().startsWith('script-src '))!;
 assert.match(scripts,/'nonce-[A-Za-z0-9+/=]+'/);
 assert.match(scripts,/'strict-dynamic'/);
 assert.doesNotMatch(scripts,/'unsafe-(?:inline|eval)'/);
 assert.match(csp,/script-src-attr 'none'/);
 assert.match(csp,/worker-src 'self' blob:/);
});
test('nonces têm 192 bits aleatórios e não se repetem', () => {
 const nonces=Array.from({length:100},criarNonce);
 assert.equal(new Set(nonces).size,100);
 for(const nonce of nonces)assert.equal(Buffer.from(nonce,'base64').length,24);
});
test('dev permite eval somente para o runtime de desenvolvimento', () => {
 assert.match(criarPoliticaScripts(criarNonce(),'http://127.0.0.1:54321',true),/'unsafe-eval'/);
 assert.match(criarPoliticaScripts(criarNonce(),'http://127.0.0.1:54321',true),/ws:\/\/127\.0\.0\.1:54321/);
});
test('nonce e origem não podem injetar diretivas ou liberar terceiros', () => {
 assert.throws(()=>criarPoliticaScripts("x'; script-src *;",'https://exemplo.supabase.co',false));
 for(const url of ['javascript:alert(1)','https://user:pass@example.com','https://example.com/path','https://example.com/?x=1','http://example.com'])assert.throws(()=>criarPoliticaScripts(criarNonce(),url,false));
 assert.doesNotMatch(criarPoliticaScripts(criarNonce(),undefined,false),/supabase\.co|\*/);
});
