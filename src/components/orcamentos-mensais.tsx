"use client";
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { formatarCentavos, centavosParaDecimalEditavel } from '@/lib/money';
import { mensagemDeErro } from '@/lib/erros';
import { calcularOrcamento,lerCentavosComZero } from '@/lib/orcamentos-mensais';

export type CategoriaOrcamento = {id:string;nome:string;padrao:number|null;definido:boolean;limite:number|null;gasto:number};
function Editor({item,mes}:{item:CategoriaOrcamento;mes:string}) {
 const router=useRouter();const [valor,setValor]=useState(item.limite===null?'':centavosParaDecimalEditavel(item.limite));
 const [erro,setErro]=useState('');const [pendente,setPendente]=useState(false);
 const resumo=calcularOrcamento(item.limite,null,item.gasto);
 async function salvar(event:React.FormEvent) {
  event.preventDefault();setErro('');const centavos=valor.trim()===''?null:lerCentavosComZero(valor);
  if((valor.trim()!==''&&centavos===null)||(centavos!==null&&(!Number.isSafeInteger(centavos)||centavos<0))){setErro('Informe um limite válido, igual ou maior que zero.');return;}
  setPendente(true);
  try{const {error}=await createClient().rpc('salvar_orcamento_mensal',{p_categoria_id:item.id,p_mes:mes+'-01',p_limite:centavos});if(error)throw error;router.refresh();}
  catch(e){setErro(mensagemDeErro(e));}finally{setPendente(false);}
 }
 return <section className="vidro-soberano grid min-w-0 gap-4 p-5" aria-label={`Orçamento de ${item.nome}`}>
  <div className="flex flex-wrap items-start justify-between gap-3"><h2 className="serifa text-xl">{item.nome}</h2><span className="text-xs">{item.definido?'Definido para este mês':'Envelope padrão'}</span></div>
  <dl className="grid grid-cols-2 gap-3 text-sm"><div><dt>Gasto registrado</dt><dd className="numero-soberano mt-1">{formatarCentavos(item.gasto)}</dd></div><div><dt>{resumo.excedido?'Acima do limite':'Disponível'}</dt><dd className="numero-soberano mt-1" style={{color:resumo.excedido?'var(--telha)':'var(--verde)'}}>{resumo.disponivel===null?'Sem limite':formatarCentavos(Math.abs(resumo.disponivel))}</dd></div></dl>
  <form onSubmit={salvar} className="grid gap-3"><label className="text-sm">Limite de {item.nome} em reais<input className="campo-soberano" inputMode="decimal" value={valor} onChange={e=>setValor(e.target.value)} placeholder="Vazio = sem limite"/></label><button className="botao-fantasma justify-self-start" disabled={pendente}>{pendente?'Salvando…':'Salvar limite do mês'}</button></form>
  {erro&&<p role="alert">{erro}</p>}
 </section>;
}
export default function OrcamentosMensais({itens,mes}:{itens:CategoriaOrcamento[];mes:string}) {
 return <div className="grid min-w-0 gap-4 md:grid-cols-2">{itens.map(item=><Editor key={mes+item.id+String(item.limite)} item={item} mes={mes}/>)}</div>;
}
