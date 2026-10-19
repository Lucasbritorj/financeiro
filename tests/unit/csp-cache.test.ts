import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { podeGravarNavegacao } = require('../../public/sw-rotas.js');
test('service worker não grava HTML com nonce nem resposta privada', () => {
 const casos:Record<string,string>[]=[
  {'Cache-Control':'private, no-store'},
  {'Content-Security-Policy':"script-src 'nonce-exemplo'"},
 ];
 for (const cabecalhos of casos) {
  assert.equal(podeGravarNavegacao('/login',{ok:true,redirected:false,headers:new Headers(cabecalhos)}),false);
 }
 assert.equal(podeGravarNavegacao('/login',{ok:true,redirected:false,headers:new Headers({'Cache-Control':'public, max-age=60'})}),true);
});
