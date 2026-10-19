import {createClient} from '@/lib/supabase/server';
import {clientePrivilegiado} from '@/lib/supabase/privilegiado';
import {autenticarPluggy,listarContasPluggy,lerTransacoesPluggy} from '@/lib/pluggy';
import type {Json} from '@/lib/database.types';
import {validarMesOrcamento} from '@/lib/orcamentos-mensais';

export const runtime='nodejs';
const responder=(body:unknown,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'private, no-store'}});
async function contexto() {
 const db=await createClient();const {data:{user},error}=await db.auth.getUser();
 if(error||!user)return {resposta:responder({erro:'Entre na sua conta para continuar.'},401)};
 const owner=process.env.PLUGGY_OWNER_USER_ID;const clientId=process.env.PLUGGY_CLIENT_ID;const secret=process.env.PLUGGY_CLIENT_SECRET;
 const itens=(process.env.PLUGGY_ITEM_IDS??'').split(',').map(s=>s.trim()).filter(Boolean);
 if(!owner||!clientId||!secret||itens.length<1)return {resposta:responder({configurada:false,mensagem:'A conexão pessoal ainda precisa ser configurada pelo titular.'})};
 if(user.id!==owner)return {resposta:responder({erro:'Esta integração é exclusiva do titular configurado.'},403)};
 if(itens.length>5||itens.some(id=>!/^[a-zA-Z0-9-]{1,100}$/.test(id)))return {resposta:responder({erro:'Configuração privada da conexão inválida.'},503)};
 return {db,clientId,secret,itens,userId:user.id};
}
export async function GET(){
 const c=await contexto();if(c.resposta)return c.resposta;
 // GET verifica somente disponibilidade; leitura externa é solicitada explicitamente pelo titular.
 return responder({configurada:true});
}
export async function POST(request:Request) {
 const origem=request.headers.get('origin');if(!origem||origem!==new URL(request.url).origin)return responder({erro:'Origem da solicitação inválida.'},403);
 const c=await contexto();if(c.resposta)return c.resposta;
 if(!request.headers.get('content-type')?.startsWith('application/json')||Number(request.headers.get('content-length')??0)>4096)return responder({erro:'Solicitação inválida.'},400);
 try{
  const texto=await request.text();if(texto.length>4096)return responder({erro:'Solicitação acima do limite.'},413);
  const body=JSON.parse(texto) as Record<string,unknown>;
  if(!body||!['LISTAR','VINCULAR','SINCRONIZAR'].includes(String(body.acao)))return responder({erro:'Ação inválida.'},400);
  const chave=await autenticarPluggy(c.clientId!,c.secret!);const contas=await listarContasPluggy(chave,c.itens!);
  if(body.acao==='LISTAR')return responder({contas});
  if(typeof body.contaId!=='string'||!/^[a-f0-9-]{36}$/i.test(body.contaId))return responder({erro:'Conta inválida.'},400);
  const consulta=await c.db!.from('contas_bancarias').select('*').eq('id',body.contaId).single();
  if(consulta.error||!consulta.data||consulta.data.user_id!==c.userId)return responder({erro:'Conta não encontrada.'},404);
  if(body.acao==='VINCULAR'){
   const selecionada=contas.find(a=>a.id===body.accountId);if(!selecionada)return responder({erro:'Conexão não pertence às contas autorizadas.'},403);
   const servidor=clientePrivilegiado();if(!servidor)return responder({erro:'O vínculo bancário precisa de configuração privada pelo titular.'},503);
   const r=await servidor.rpc('vincular_conta_pluggy_servidor',{p_user_id:c.userId!,p_conta_id:body.contaId,p_account_id:selecionada.id,p_item_id:selecionada.itemId});if(r.error)return responder({erro:'Não foi possível vincular esta conta. Ela pode já ter outro vínculo.'},409);
   return responder({vinculada:true});
  }
  const conta=contas.find(a=>a.id===consulta.data.pluggy_account_id&&a.itemId===consulta.data.pluggy_item_id);
  if(!conta)return responder({erro:'Vincule uma conta autorizada antes de sincronizar.'},409);
  if(typeof body.mes!=='string'||!validarMesOrcamento(body.mes))return responder({erro:'Selecione um mês válido.'},400);
  const de=body.mes+'-01';const ate=new Date(Date.UTC(Number(body.mes.slice(0,4)),Number(body.mes.slice(5,7)),0)).toISOString().slice(0,10);
  const {linhas,pendentes}=await lerTransacoesPluggy(chave,conta.id,de,ate);
  let resultado:Json={novas:0,repetidas:0};
  if(linhas.length){const r=await c.db!.rpc('importar_extrato_conta',{p_conta_id:body.contaId,p_origem:'PLUGGY',p_linhas:linhas as unknown as Json});if(r.error)return responder({erro:'Não foi possível receber as linhas. Confira saldo inicial, períodos fechados e dados alterados na origem.'},409);resultado=r.data;}
  return responder({resultado,pendentes,saldoInformadoPeloProvedor:conta.saldo,atualizadaEm:conta.atualizadaEm,mensagem:'Dados recebidos para revisão. Nenhum gasto foi confirmado automaticamente.'});
 }catch{return responder({erro:'Conexão bancária indisponível ou resposta inválida. Seus lançamentos foram preservados.'},502);}
}
