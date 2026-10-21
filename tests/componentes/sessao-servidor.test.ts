import {beforeEach,expect,test,vi} from 'vitest';
const m=vi.hoisted(()=>({login:vi.fn(),signup:vi.fn(),sair:vi.fn(),senha:vi.fn(),reset:vi.fn(),user:vi.fn(),session:vi.fn(),limite:vi.fn(),fetch:vi.fn()}));
vi.mock('@/lib/supabase/server',()=>({createClient:async()=>({auth:{getUser:m.user,getSession:m.session,signInWithPassword:m.login,signUp:m.signup,signOut:m.sair,updateUser:m.senha,resetPasswordForEmail:m.reset}})}));
vi.mock('@/lib/limite-servidor',()=>({verificarLimite:m.limite}));
vi.mock('@/lib/supabase/fetch',()=>({fetchComTimeout:m.fetch}));
import {POST as authPOST} from '@/app/api/auth/route';
import {POST as dadosPOST,GET as dadosGET} from '@/app/api/dados/[...caminho]/route';
const pedir=(body:unknown,origin='https://app.test')=>new Request('https://app.test/api/auth',{method:'POST',headers:{origin,'Content-Type':'application/json'},body:JSON.stringify(body)});
beforeEach(()=>{vi.clearAllMocks();vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL','https://banco.example.test');vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY','anon-ficticia');m.user.mockResolvedValue({data:{user:{id:'titular',email:'teste@example.test'}},error:null});m.session.mockResolvedValue({data:{session:{access_token:'token-secreto-fixture'}}});m.limite.mockResolvedValue(null);m.login.mockResolvedValue({data:{user:{id:'titular',email:'teste@example.test'},session:{access_token:'NUNCA',refresh_token:'NUNCA'}},error:null});m.sair.mockResolvedValue({error:null});m.senha.mockResolvedValue({error:null});m.fetch.mockResolvedValue(Response.json([{id:'fixture'}]));});
test('login devolve estado mínimo e nunca devolve tokens',async()=>{
 const r=await authPOST(pedir({acao:'entrar',email:'teste@example.test',password:'senha-ficticia'}));expect(r.status).toBe(200);const body=await r.text();expect(body).toContain('autenticado');expect(body).not.toMatch(/access_token|refresh_token|NUNCA/);
});
test('origem externa é recusada antes de autenticar ou consumir cota',async()=>{
 expect((await authPOST(pedir({acao:'entrar'},'https://externo.test'))).status).toBe(403);expect(m.login).not.toHaveBeenCalled();expect(m.limite).not.toHaveBeenCalled();
});
test('excesso e falha de limite impedem login',async()=>{
 m.limite.mockResolvedValue(Response.json({erro:'Aguarde'},{status:429}));expect((await authPOST(pedir({acao:'entrar',email:'teste@example.test',password:'senha-ficticia'}))).status).toBe(429);expect(m.login).not.toHaveBeenCalled();
});
test('senha alterada revoga globalmente; falha não vira sucesso',async()=>{
 m.sair.mockResolvedValue({error:{message:'erro secreto'}});const r=await authPOST(pedir({acao:'senha',password:'senha-ficticia'}));expect(r.status).toBe(503);expect(m.sair).toHaveBeenCalledWith({scope:'global'});expect(await r.text()).not.toContain('erro secreto');
});
test('ponte usa token do servidor e nunca aceita credencial ou schema do pedido',async()=>{
 const ctx={params:Promise.resolve({caminho:['rpc','registrar_receita']})};
 const req=new Request('https://app.test/api/dados/rpc/registrar_receita',{method:'POST',headers:{origin:'https://app.test','content-type':'application/json',authorization:'Bearer atacante',apikey:'atacante'},body:'{}'});
 expect((await dadosPOST(req,ctx)).status).toBe(200);
 const [url,init]=m.fetch.mock.calls[0];expect(url.href).toBe('https://banco.example.test/rest/v1/rpc/registrar_receita');expect(init.headers.get('authorization')).toBe('Bearer token-secreto-fixture');expect(init.headers.get('apikey')).toBe('anon-ficticia');
 const r=await dadosGET(new Request('https://app.test/api/dados/transacoes_origem',{headers:{'accept-profile':'auth'}}),{params:Promise.resolve({caminho:['transacoes_origem']})});expect(r.status).toBe(400);
});
test('ponte rejeita CSRF, destinos arbitrários e excesso sem chamar banco externo',async()=>{
 const r=await dadosPOST(new Request('https://app.test/api/dados/rpc/teste',{method:'POST',headers:{origin:'https://externo.test'},body:'{}'}),{params:Promise.resolve({caminho:['rpc','teste']})});expect(r.status).toBe(403);
 const x=await dadosGET(new Request('https://app.test/api/dados/auth/v1/token'),{params:Promise.resolve({caminho:['auth','v1','token']})});expect(x.status).toBe(400);expect(m.fetch).not.toHaveBeenCalled();
});
test('lote é assinado no servidor; cabeçalho do cliente não substitui assinatura',async()=>{
 vi.stubEnv('FINANCEIRO_RPC_SIGNING_KEY','a'.repeat(64));
 const ctx={params:Promise.resolve({caminho:['rpc','criar_importacao']})};
 const req=new Request('https://app.test/api/dados/rpc/criar_importacao',{method:'POST',headers:{origin:'https://app.test','content-type':'application/json','x-financeiro-assinatura':'forjada'},body:'{}'});
 expect((await dadosPOST(req,ctx)).status).toBe(200);
 const headers=m.fetch.mock.calls[0][1].headers;expect(headers.get('x-financeiro-assinatura')).toMatch(/^[a-f0-9]{64}$/);expect(headers.get('x-financeiro-assinatura')).not.toBe('forjada');
 expect(m.limite).toHaveBeenCalledBefore(m.fetch);
});
