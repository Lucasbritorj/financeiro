import {test} from 'node:test';
import assert from 'node:assert/strict';
import {opcoesCookieSessao,origemPermitida,lerJsonLimitado,caminhoDadosPermitido} from '../../src/lib/seguranca-http.ts';
test('cookie de produção não é legível nem transmitido sem HTTPS',()=>{
 assert.deepEqual(opcoesCookieSessao(true),{httpOnly:true,secure:true,sameSite:'lax',path:'/'});
 assert.equal(opcoesCookieSessao(false).httpOnly,true);
});
test('origem externa ou ausente não autoriza escrita com cookie',()=>{
 const url='https://app.example.test/api/auth';
 assert.equal(origemPermitida(new Request(url,{headers:{origin:'https://app.example.test'}})),true);
 for(const origin of ['', 'https://malicioso.test','null'])assert.equal(origemPermitida(new Request(url,{headers:origin?{origin}:{}})),false);
});
test('ponte só aceita consultas e RPCs públicas identificáveis',()=>{
 for(const p of ['transacoes_origem','vw_previsoes_parcelamento','rpc/registrar_receita'])assert.equal(caminhoDadosPermitido(p),true);
 for(const p of ['../auth/v1','https://malicioso.test','rpc/x/y','rpc/%2e%2e','rpc/a?x=y','auth/v1/token',''])assert.equal(caminhoDadosPermitido(p),false);
});
test('Host público é usado atrás do servidor Next e cabeçalho forwarded arbitrário não autoriza origem externa',()=>{
 const url='http://localhost:3100/api/auth';
 assert.equal(origemPermitida(new Request(url,{headers:{host:'127.0.0.1:3100',origin:'http://127.0.0.1:3100'}})),true);
 assert.equal(origemPermitida(new Request(url,{headers:{host:'127.0.0.1:3100',origin:'https://externo.test','x-forwarded-host':'externo.test'}})),false);
});
test('limite do corpo considera bytes reais mesmo sem content-length',async()=>{
 await assert.rejects(()=>lerJsonLimitado(new Request('https://app.test',{method:'POST',body:JSON.stringify({x:'á'.repeat(20)})}),30));
 assert.deepEqual(await lerJsonLimitado(new Request('https://app.test',{method:'POST',body:'{"acao":"sair"}'}),30),{acao:'sair'});
});
