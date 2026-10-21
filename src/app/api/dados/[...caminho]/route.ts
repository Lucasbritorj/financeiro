import {NextResponse} from 'next/server';
import {createClient} from '@/lib/supabase/server';
import {fetchComTimeout} from '@/lib/supabase/fetch';
import {caminhoDadosPermitido,origemPermitida,lerJsonLimitado} from '@/lib/seguranca-http';
import {verificarLimite} from '@/lib/limite-servidor';
import {mensagemDeErro} from '@/lib/erros';
import {registrarEvento} from '@/lib/eventos-seguranca';
import {RPCS_PROTEGIDAS,gerarAssinaturaRpc} from '@/lib/assinatura-rpc';
type Contexto={params:Promise<{caminho:string[]}>};
export const runtime='nodejs';
async function atender(request:Request,ctx:Contexto){
 const headers={'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'};
 const falha=(erro:string,status:number,code='FW400')=>NextResponse.json({message:erro,code},{status,headers});
 const caminho=(await ctx.params).caminho.join('/');const rpc=caminho.startsWith('rpc/');
 if(!caminhoDadosPermitido(caminho)||new URL(request.url).search.length>8192||(request.method==='POST'&&!rpc)||(request.method!=='POST'&&rpc))return falha('Solicitação inválida.',400);
 if(request.method==='POST'&&!origemPermitida(request)){registrarEvento('origem_recusada','dados');return falha('Origem inválida.',403);}
 if(request.headers.get('accept-profile')&&request.headers.get('accept-profile')!=='public')return falha('Schema inválido.',400);
 if(request.headers.get('content-profile')&&request.headers.get('content-profile')!=='public')return falha('Schema inválido.',400);
 const resposta=new NextResponse(null,{headers});
 try{
  const db=await createClient(resposta);const {data:{user},error}=await db.auth.getUser();
  if(error||!user)return falha('Entre novamente para continuar.',401,'FW401');
  const limitado=await verificarLimite('dados',user.id);if(limitado)return limitado;
  let body:string|undefined;
  if(request.method==='POST'){
   if(!request.headers.get('content-type')?.startsWith('application/json'))return falha('Envie JSON.',415);
   try{body=JSON.stringify(await lerJsonLimitado(request,2*1024*1024));}catch{return falha('Solicitação inválida ou acima do limite.',413);}
  }
  const {data:{session}}=await db.auth.getSession();if(!session)return falha('Entre novamente.',401,'FW401');
  const destino=new URL('/rest/v1/'+caminho,process.env.NEXT_PUBLIC_SUPABASE_URL!);destino.search=new URL(request.url).search;
  const envio=new Headers({'apikey':process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,'Authorization':'Bearer '+session.access_token,'Accept-Profile':'public','Content-Profile':'public'});
  if(RPCS_PROTEGIDAS.has(caminho.slice(4)))for(const [k,v] of Object.entries(gerarAssinaturaRpc(process.env.FINANCEIRO_RPC_SIGNING_KEY,user.id,caminho.slice(4))))envio.set(k,v);
  for(const h of ['accept','content-type','prefer','range','range-unit']){const v=request.headers.get(h);if(v)envio.set(h,v);}
  const retorno=await fetchComTimeout(destino,{method:request.method,headers:envio,body,cache:'no-store',redirect:'error'});
  if(!retorno.ok){const e=await retorno.json().catch(()=>null);return falha(mensagemDeErro(e),retorno.status,/^FW4\d{2}$/.test(e?.code??'')?e.code:'FW503');}
  const r=new NextResponse(retorno.body,{status:retorno.status,headers});
  for(const h of ['content-type','content-range','range-unit','preference-applied']){const v=retorno.headers.get(h);if(v)r.headers.set(h,v);}
  for(const c of resposta.cookies.getAll())r.cookies.set(c);
  return r;
 }catch{registrarEvento('dependencia_indisponivel','dados');return falha('Serviço temporariamente indisponível.',503,'FW503');}
}
export const GET=atender;
export const HEAD=atender;
export const POST=atender;
