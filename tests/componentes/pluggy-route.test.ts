import {beforeEach,afterEach,describe,it,expect,vi} from 'vitest';
const mocks=vi.hoisted(()=>({getUser:vi.fn(),autenticar:vi.fn(),listar:vi.fn(),conta:vi.fn(),rpc:vi.fn(),privado:vi.fn()}));
vi.mock('@/lib/supabase/server',()=>({createClient:async()=>({auth:{getUser:mocks.getUser},from:()=>({select:()=>({eq:()=>({single:mocks.conta})})})})}));
vi.mock('@/lib/supabase/privilegiado',()=>({clientePrivilegiado:mocks.privado}));
vi.mock('@/lib/pluggy',()=>({autenticarPluggy:mocks.autenticar,listarContasPluggy:mocks.listar,lerTransacoesPluggy:vi.fn()}));
import {GET,POST} from '@/app/api/pluggy/route';
beforeEach(()=>{vi.clearAllMocks();mocks.getUser.mockResolvedValue({data:{user:{id:'titular-teste'}},error:null});mocks.conta.mockResolvedValue({data:{user_id:'titular-teste'},error:null});mocks.listar.mockResolvedValue([{id:'account-ficticio',itemId:'item-ficticio'}]);mocks.rpc.mockResolvedValue({error:null});mocks.privado.mockReturnValue({rpc:mocks.rpc});vi.stubEnv('PLUGGY_OWNER_USER_ID','titular-teste');vi.stubEnv('PLUGGY_CLIENT_ID','id-ficticio');vi.stubEnv('PLUGGY_CLIENT_SECRET','segredo-ficticio');vi.stubEnv('PLUGGY_ITEM_IDS','item-ficticio');});
afterEach(()=>vi.unstubAllEnvs());
describe('fronteira pessoal Pluggy',()=>{
 const vincular=(accountId='account-ficticio')=>new Request('https://app.example.test/api/pluggy',{method:'POST',headers:{origin:'https://app.example.test','Content-Type':'application/json'},body:JSON.stringify({acao:'VINCULAR',contaId:'00000000-0000-0000-0000-000000000001',accountId})});
 it('vínculo usa somente RPC privilegiada com titular autenticado e ID verificado no provedor',async()=>{
  expect((await POST(vincular())).status).toBe(200);
  expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith('vincular_conta_pluggy_servidor',{p_user_id:'titular-teste',p_conta_id:'00000000-0000-0000-0000-000000000001',p_account_id:'account-ficticio',p_item_id:'item-ficticio'});
 });
 it('não cria cliente privilegiado para ID do provedor não autorizado',async()=>{
  expect((await POST(vincular('outra-account'))).status).toBe(403);expect(mocks.privado).not.toHaveBeenCalled();
 });
 it('confere proprietário interno mesmo antes de usar o cliente privilegiado',async()=>{
  mocks.conta.mockResolvedValue({data:{user_id:'outro'},error:null});expect((await POST(vincular())).status).toBe(404);expect(mocks.privado).not.toHaveBeenCalled();
 });
 it('configuração privilegiada ausente recusa vínculo sem fallback ou detalhes internos',async()=>{
  mocks.privado.mockReturnValue(null);const r=await POST(vincular());expect(r.status).toBe(503);expect(mocks.rpc).not.toHaveBeenCalled();expect(await r.text()).not.toContain('segredo-ficticio');
 });
 it('exige autenticação mesmo quando não há configuração',async()=>{
  mocks.getUser.mockResolvedValue({data:{user:null},error:null});expect((await GET()).status).toBe(401);expect(mocks.autenticar).not.toHaveBeenCalled();
 });
 it('bloqueia qualquer outro titular sem consultar o provedor',async()=>{
  mocks.getUser.mockResolvedValue({data:{user:{id:'outro'}},error:null});expect((await GET()).status).toBe(403);expect(mocks.autenticar).not.toHaveBeenCalled();
 });
 it('status não expõe credenciais nem chama provedor',async()=>{
  const r=await GET();expect(await r.json()).toEqual({configurada:true});expect(mocks.autenticar).not.toHaveBeenCalled();expect(r.headers.get('cache-control')).toContain('no-store');
 });
 it('origem externa é recusada antes de qualquer leitura bancária',async()=>{
  const req=new Request('https://app.example.test/api/pluggy',{method:'POST',headers:{origin:'https://externo.example.test','Content-Type':'application/json'},body:'{"acao":"LISTAR"}'});
  expect((await POST(req)).status).toBe(403);expect(mocks.autenticar).not.toHaveBeenCalled();
 });
 it('configuração ausente explica indisponibilidade sem inventar dados',async()=>{
  vi.stubEnv('PLUGGY_CLIENT_SECRET','');const r=await GET();expect((await r.json()).configurada).toBe(false);
 });
 it('erro do provedor não devolve detalhes secretos da dependência',async()=>{
  mocks.autenticar.mockRejectedValue(new Error('segredo-ficticio'));
  const req=new Request('https://app.example.test/api/pluggy',{method:'POST',headers:{origin:'https://app.example.test','Content-Type':'application/json'},body:'{"acao":"LISTAR"}'});
  const r=await POST(req);expect(r.status).toBe(502);expect(await r.text()).not.toContain('segredo-ficticio');
 });
});
