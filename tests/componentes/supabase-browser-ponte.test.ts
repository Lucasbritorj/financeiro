import {afterEach,expect,test,vi} from 'vitest';
import {createClient} from '@/lib/supabase/client';
afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs();});
test('builder real de RPC usa somente API própria sem credencial no pedido browser',async()=>{
 vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL','https://banco.example.test');vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY','anon-fixture');
 const fetch=vi.fn(async()=>Response.json({id:'fixture'}));vi.stubGlobal('fetch',fetch);
 const db=createClient();const resultado=await db.rpc('registrar_receita',{p_descricao:'Receita fictícia',p_valor:100,p_forma:'PIX',p_data:'2026-10-21'} as never);
 expect(resultado.error).toBeNull();expect(resultado.data).toEqual({id:'fixture'});
 const [url,init]=fetch.mock.calls[0] as unknown as [string,RequestInit];expect(url).toBe('/api/dados/rpc/registrar_receita');expect(new Headers(init.headers).has('authorization')).toBe(false);expect(new Headers(init.headers).has('apikey')).toBe(false);expect(init.credentials).toBe('same-origin');
});
test('login real da fachada não consulta Auth externo nem persiste sessão no JavaScript',async()=>{
 vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL','https://banco.example.test');vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY','anon-fixture');
 const fetch=vi.fn(async()=>Response.json({autenticado:true,user:{id:'ficticio'}}));vi.stubGlobal('fetch',fetch);
 const db=createClient();const r=await db.auth.signInWithPassword({email:'fixture@example.test',password:'senha-fixture'});
 expect(r.error).toBeNull();expect(fetch).toHaveBeenCalledWith('/api/auth',expect.objectContaining({method:'POST'}));expect((await db.auth.getSession()).data.session).toBeNull();
});
