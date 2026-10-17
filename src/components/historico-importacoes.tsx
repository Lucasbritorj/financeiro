"use client";

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useConfirm, useToast } from './feedback';
import { createClient } from '@/lib/supabase/client';
import { mensagemDeErro } from '@/lib/erros';
import { formatarCentavos, formatarData } from '@/lib/money';
import type { Database } from '@/lib/database.types';

export type LoteHistorico = Database['public']['Views']['vw_historico_importacoes']['Row'];
type Previa = {
 permitido: boolean; motivo: string | null; tipo: string; lote_id: string; token: string;
 quantidade: number|null; total: number; receitas: number; despesas: number;
 assinaturas_preservadas: number; planos_removidos: number; previsoes_removidas: number;
 lancamentos: {id:string;descricao:string;data:string;valor:number;tipo:string}[];
};
const quando = (iso: string) => new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Sao_Paulo',dateStyle:'short',timeStyle:'short'}).format(new Date(iso));

export default function HistoricoImportacoes({lotes,erroConsulta}:{lotes:LoteHistorico[];erroConsulta?:boolean}) {
 const router=useRouter(); const confirmar=useConfirm(); const notificar=useToast(); const ocupado=useRef(false);
 const [limite,setLimite]=useState(10);const [previa,setPrevia]=useState<Previa|null>(null);
 const [pendente,setPendente]=useState(false);const [erro,setErro]=useState<string|null>(null);
 async function consultar(lote:LoteHistorico) {
  if(ocupado.current)return;ocupado.current=true;setPendente(true);setErro(null);setPrevia(null);
  try {
   const {data,error}=await createClient().rpc('consultar_reversao_importacao',{p_tipo:lote.tipo,p_id:lote.lote_id});
   if(error)throw error;
   setPrevia(data as unknown as Previa);
  }catch(e){setErro(mensagemDeErro(e));}finally{ocupado.current=false;setPendente(false);}
 }
 async function desfazer() {
  if(!previa?.permitido||ocupado.current)return;
  ocupado.current=true;setPendente(true);setErro(null);
  try {
   const aceito=await confirmar({titulo:'Desfazer esta importação?',mensagem:`Serão retirados ${previa.quantidade} lançamentos: ${formatarCentavos(previa.receitas)} em entradas e ${formatarCentavos(previa.despesas)} em despesas. Cadastros e contratos de assinatura serão mantidos.`,rotuloConfirmar:'Desfazer importação',perigo:true});
   if(!aceito)return;
   const {error}=await createClient().rpc('desfazer_importacao',{p_tipo:previa.tipo,p_id:previa.lote_id,p_token:previa.token});
   if(error)throw error;
   setPrevia(null);notificar('Importação desfeita. Você pode revisar e importar o arquivo novamente.');router.refresh();
  }catch(e){setErro(mensagemDeErro(e));setPrevia(null);}finally{ocupado.current=false;setPendente(false);}
 }
 const ordenados=lotes.toSorted((a,b)=>b.created_at.localeCompare(a.created_at)||a.id.localeCompare(b.id));
 return <section className="vidro-soberano grid min-w-0 gap-4 p-5" aria-labelledby="historico-importacoes">
  <header className="flex flex-wrap items-baseline justify-between gap-3"><h2 id="historico-importacoes" className="serifa text-xl">Histórico de importações</h2>
   <button type="button" className="botao-fantasma text-sm" disabled={pendente} onClick={()=>router.refresh()}>Atualizar histórico</button></header>
  <p className="text-sm" style={{color:'var(--grafite)'}}>Confira os lançamentos e os impedimentos antes de desfazer. Cartões, categorias, faturas e contratos de assinatura permanecem cadastrados.</p>
  {erroConsulta?<p role="alert">Não foi possível carregar o histórico. Tente atualizar; se persistir, confira a instalação desta versão.</p>:ordenados.length===0?<p>Nenhuma importação confirmada.</p>:<ul className="grid min-w-0 gap-3">
   {ordenados.slice(0,limite).map(l=><li key={l.id} className="flex min-w-0 flex-wrap items-center justify-between gap-3 border-t pt-3" style={{borderColor:'var(--borda)'}}>
    <div className="min-w-0"><p className="font-medium">{l.tipo==='FATURA'?'Fatura':'Extrato'} {l.origem}{l.competencia?` · ${l.competencia.slice(0,7)}`:''}</p>
     <p className="text-xs" style={{color:'var(--grafite)'}}>{quando(l.created_at)} · {l.quantidade===null?'Quantidade não disponível':`${l.quantidade} lançamento(s)`}{l.desfeita_em?' · Desfeita':''}</p></div>
    {!l.desfeita_em&&<button type="button" className="botao-fantasma text-sm" disabled={pendente} onClick={()=>void consultar(l)}>Conferir reversão</button>}
   </li>)}
  </ul>}
  {ordenados.length>limite&&<button type="button" className="botao-fantasma justify-self-start" onClick={()=>setLimite(l=>l+10)}>Mostrar mais importações</button>}
  {pendente&&<p role="status">Conferindo importação…</p>}
  {erro&&<p role="alert">{erro} Atualize o histórico e confira a prévia novamente.</p>}
  {previa&&<section className="grid min-w-0 gap-3 rounded-xl border p-4" style={{borderColor:'var(--borda-forte)'}} aria-label="Prévia da reversão">
   <h3 className="serifa text-lg">O que será retirado</h3>
   {previa.quantidade===null?<p>Este lote antigo não possui vínculo suficiente para identificar os lançamentos com segurança.</p>:<p>{previa.quantidade} lançamento(s): entradas de {formatarCentavos(previa.receitas)} e despesas de {formatarCentavos(previa.despesas)}.</p>}
   <p className="text-sm">{previa.planos_removidos} plano(s) exclusivo(s) do lote serão removidos, retirando {formatarCentavos(previa.previsoes_removidas)} de estimativas futuras. Planos compartilhados serão preservados.</p>
   <p className="text-sm">Contratos de assinatura serão mantidos ({previa.assinaturas_preservadas} vinculado(s) neste lote). Ao reimportar, escolha vincular à assinatura existente.</p>
   <details><summary className="cursor-pointer text-sm">Conferir lançamentos deste lote</summary><ul className="mt-3 grid min-w-0 gap-2">{previa.lancamentos.map(l=><li key={l.id} className="min-w-0 break-words text-sm">{formatarData(l.data)} · {l.descricao} · {l.tipo==='RECEITA'?'Entrada':'Despesa'} {formatarCentavos(l.valor)}</li>)}</ul></details>
   {!previa.permitido&&<p role="alert">{previa.motivo}</p>}
   <div className="flex flex-wrap gap-3"><button type="button" className="botao-fantasma" disabled={!previa.permitido||pendente} onClick={()=>void desfazer()}>Desfazer esta importação</button>
    <button type="button" className="botao-fantasma" disabled={pendente} onClick={()=>setPrevia(null)}>Fechar prévia</button></div>
  </section>}
 </section>;
}
