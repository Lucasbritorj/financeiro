import {NextResponse} from 'next/server';
import {createClient} from '@/lib/supabase/server';
import {origemPermitida,origemPublica,lerJsonLimitado} from '@/lib/seguranca-http';
import {verificarLimite,type AcaoLimitada} from '@/lib/limite-servidor';
import {mensagemDeErro} from '@/lib/erros';
import {registrarEvento} from '@/lib/eventos-seguranca';
export const runtime='nodejs';
const cabecalhos={'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'};
export async function GET(){
 try{const db=await createClient();const {data:{user},error}=await db.auth.getUser();return NextResponse.json({user:error?null:user&&{id:user.id,email:user.email}},{status:error||!user?401:200,headers:cabecalhos});}
 catch{return NextResponse.json({erro:'Não foi possível validar sua sessão.'},{status:503,headers:cabecalhos});}
}
export async function POST(request:Request){
 if(!origemPermitida(request)){registrarEvento('origem_recusada','auth');return NextResponse.json({erro:'Origem inválida.'},{status:403,headers:cabecalhos});}
 if(!request.headers.get('content-type')?.startsWith('application/json'))return NextResponse.json({erro:'Envie JSON.'},{status:415,headers:cabecalhos});
 let body:Record<string,unknown>;
 try{body=await lerJsonLimitado(request,4096);}catch{return NextResponse.json({erro:'Solicitação inválida.'},{status:400,headers:cabecalhos});}
 const acao=body.acao;
 if(typeof acao!=='string'||!['entrar','cadastrar','recuperar','senha','sair'].includes(acao))return NextResponse.json({erro:'Ação inválida.'},{status:400,headers:cabecalhos});
 const resposta=NextResponse.json({}, {headers:cabecalhos});
 function concluir(valor:unknown,status=200){const r=NextResponse.json(valor,{status,headers:cabecalhos});for(const c of resposta.cookies.getAll())r.cookies.set(c);return r;}
 try{
  const db=await createClient(resposta);
  let userId:string|null=null;
  if(acao==='senha'||acao==='sair'){
   const {data:{user},error}=await db.auth.getUser();
   if(error||!user)return concluir({erro:'Entre novamente para continuar.',code:'FW401'},401);
   userId=user.id;
  }
  const ip=process.env.VERCEL==='1'?(request.headers.get('x-vercel-forwarded-for')??'desconhecido'):'local';
  if(!userId){const global=await verificarLimite('auth_ip',ip);if(global)return global;}
  const identidade=userId??(ip+'|'+(typeof body.email==='string'?body.email.trim().toLowerCase():''));
  const limitado=await verificarLimite(acao as AcaoLimitada,identidade);if(limitado)return limitado;
  if(['entrar','cadastrar','recuperar'].includes(acao)&&(typeof body.email!=='string'||body.email.length>254||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email.trim())))return concluir({erro:'Informe um e-mail válido.',code:'FW400'},400);
  if(['entrar','cadastrar','senha'].includes(acao)&&(typeof body.password!=='string'||body.password.length<8||body.password.length>128))return concluir({erro:'Use uma senha de 8 a 128 caracteres.',code:'FW400'},400);
  if(acao==='recuperar'){
   const {error}=await db.auth.resetPasswordForEmail((body.email as string).trim(),{redirectTo:origemPublica(request)+'/login/confirmar'});if(error)throw error;
   return concluir({enviado:true});
  }
  if(acao==='sair'){
   const {error}=await db.auth.signOut({scope:'global'});
   if(error){registrarEvento('logout_recusado','sair');throw error;}
   return concluir({saiu:true});
  }
  if(acao==='senha'){
   const {error}=await db.auth.updateUser({password:body.password as string});if(error)throw error;
   const revogacao=await db.auth.signOut({scope:'global'});
   if(revogacao.error){registrarEvento('logout_recusado','senha');return concluir({erro:'Senha alterada, mas não foi possível encerrar as sessões. Tente sair novamente.',code:'FW409'},503);}
   registrarEvento('senha_alterada','senha');return concluir({atualizada:true});
  }
  const credenciais={email:(body.email as string).trim(),password:body.password as string};
  const {data,error}=acao==='entrar'?await db.auth.signInWithPassword(credenciais):await db.auth.signUp(credenciais);
  if(error){registrarEvento('login_recusado',acao);throw error;}
  return concluir({autenticado:!!data.session,user:data.user&&{id:data.user.id,email:data.user.email}});
 }catch(error){
  const mensagem=mensagemDeErro(error);return concluir({erro:mensagem,code:mensagem==='Erro inesperado. Tente de novo.'?'FW503':'FW400'},mensagem==='Erro inesperado. Tente de novo.'?503:400);
 }
}
