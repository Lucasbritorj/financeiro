import { beforeEach, expect, test, vi } from 'vitest';
import { NextRequest } from 'next/server';
const estado=vi.hoisted(()=>({usuario:false,renovar:false}));
vi.mock('@supabase/ssr',()=>({createServerClient:(_url:unknown,_key:unknown,opcoes:{cookies:{setAll:(cookies:{name:string;value:string;options:{httpOnly:boolean}}[])=>void}})=>({auth:{getUser:async()=>{
 if(estado.renovar)opcoes.cookies.setAll([{name:'sessao-teste',value:'valor-ficticio',options:{httpOnly:true}}]);
 return {data:{user:estado.usuario?{id:'ficticio'}:null}};
}}})}));
import { proxy } from '../../src/proxy';
beforeEach(()=>{estado.usuario=false;estado.renovar=false;vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL','https://exemplo.supabase.co');});

test('substitui nonce e CSP forjados e encaminha uma única política ao Next',async()=>{
 const resposta=await proxy(new NextRequest('https://app.example/login',{headers:{'x-nonce':'forjado','Content-Security-Policy':'script-src *'}}));
 const nonce=resposta.headers.get('x-middleware-request-x-nonce');
 expect(nonce).toMatch(/^[A-Za-z0-9+/]{32}$/);
 expect(nonce).not.toBe('forjado');
 expect(resposta.headers.get('Content-Security-Policy')).toContain(`'nonce-${nonce}'`);
 expect(resposta.headers.get('x-middleware-request-content-security-policy')).toBe(resposta.headers.get('Content-Security-Policy'));
 expect(resposta.headers.get('Cache-Control')).toBe('private, no-store');
});
test('renovação conserva cookies, nonce encaminhado e política',async()=>{
 estado.usuario=true;estado.renovar=true;
 const resposta=await proxy(new NextRequest('https://app.example/dashboard'));
 expect(resposta.cookies.get('sessao-teste')?.value).toBe('valor-ficticio');
 expect(resposta.headers.get('x-middleware-request-cookie')).toContain('sessao-teste=valor-ficticio');
 expect(resposta.headers.get('Content-Security-Policy')).toContain(`'nonce-${resposta.headers.get('x-middleware-request-x-nonce')}'`);
});
test('redirecionamentos preservam cookies renovados e política e não reutilizam nonce',async()=>{
 estado.renovar=true;
 const a=await proxy(new NextRequest('https://app.example/dashboard'));
 expect(a.headers.get('location')).toBe('https://app.example/login');
 estado.usuario=true;
 const b=await proxy(new NextRequest('https://app.example/login'));
 expect(b.headers.get('location')).toBe('https://app.example/transacoes');
 for(const resposta of [a,b]){
  expect(resposta.cookies.get('sessao-teste')?.value).toBe('valor-ficticio');
  expect(resposta.headers.get('Content-Security-Policy')).toMatch(/'nonce-/);
  expect(resposta.headers.get('Cache-Control')).toBe('private, no-store');
 }
 expect(a.headers.get('Content-Security-Policy')).not.toBe(b.headers.get('Content-Security-Policy'));
});
