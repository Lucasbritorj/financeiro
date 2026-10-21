import 'server-only';
import {createHash} from 'node:crypto';
import {clientePrivilegiado} from './supabase/privilegiado';
import {registrarEvento} from './eventos-seguranca';
export type AcaoLimitada='auth_ip'|'entrar'|'cadastrar'|'recuperar'|'senha'|'sair'|'dados'|'pluggy'|'exportar';
export async function verificarLimite(acao:AcaoLimitada,identidade:string):Promise<Response|null> {
 try{
  const servidor=clientePrivilegiado();if(!servidor)throw new Error('Limite indisponível.');
  const chave=createHash('sha256').update(acao+'\0'+identidade).digest('hex');
  const {data,error}=await servidor.rpc('consumir_limite_servidor',{p_chave:chave,p_acao:acao});
  const r=data as {permitido?:boolean;aguardar?:number}|null;
  if(error||typeof r?.permitido!=='boolean')throw new Error('Limite indisponível.');
  if(r.permitido)return null;
  registrarEvento('limite_excedido',acao);
  return Response.json({erro:'Muitas tentativas. Aguarde antes de tentar novamente.',code:'FW429'},{status:429,headers:{'Retry-After':String(Math.max(1,Math.min(3600,Number(r.aguardar)||60))),'Cache-Control':'private, no-store'}});
 }catch{registrarEvento('dependencia_indisponivel','limite');return Response.json({erro:'Serviço temporariamente indisponível. Tente novamente.'},{status:503,headers:{'Cache-Control':'private, no-store'}});}
}
