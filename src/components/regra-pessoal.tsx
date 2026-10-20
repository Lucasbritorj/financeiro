'use client';

import {useState} from 'react';
import {useRouter} from 'next/navigation';
import Link from 'next/link';
import {createClient} from '@/lib/supabase/client';
import {mensagemDeErro} from '@/lib/erros';

type Previa={versao:string;tipo:string;total:number;exemplos:{id:string;descricao:string}[];amplo:boolean;conflito:string|null};

export default function RegraPessoal({transacaoId,categoriaId,descricao}:{transacaoId:string;categoriaId:string;descricao:string}) {
 const router=useRouter();
 const [aberto,setAberto]=useState(false);
 const [padrao,setPadrao]=useState(descricao.trim());
 const [prioridade,setPrioridade]=useState('100');
 const [previa,setPrevia]=useState<Previa|null>(null);
 const [chave,setChave]=useState('');
 const [conferido,setConferido]=useState(false);
 const [ocupado,setOcupado]=useState(false);
 const [erro,setErro]=useState('');
 const [aviso,setAviso]=useState('');
 const valido=padrao.trim().length>=3&&padrao.trim().length<=200&&/^\d{1,6}$/.test(prioridade)&&Number(prioridade)<=100000;
 function invalidar(){setPrevia(null);setConferido(false);setChave('');setErro('');setAviso('');}
 async function consultar(){
  setOcupado(true);setErro('');setPrevia(null);setConferido(false);
  try{
   const {data,error}=await createClient().rpc('consultar_previa_regra',{p_transacao_id:transacaoId,p_categoria_id:categoriaId,p_padrao:padrao.trim(),p_prioridade:Number(prioridade)}).abortSignal(AbortSignal.timeout(15000));
   if(error)throw error;
   setPrevia(data as unknown as Previa);setChave(crypto.randomUUID());
  }catch(e){setErro(mensagemDeErro(e));}finally{setOcupado(false);}
 }
 async function salvar(){
  if(!previa||!conferido||previa.conflito)return;
  setOcupado(true);setErro('');
  try{
   const {error}=await createClient().rpc('salvar_regra_pessoal',{p_chave:chave,p_transacao_id:transacaoId,p_categoria_id:categoriaId,p_padrao:padrao.trim(),p_prioridade:Number(prioridade),p_versao:previa.versao}).abortSignal(AbortSignal.timeout(15000));
   if(error)throw error;
   setAviso('Regra salva. Próximas movimentações semelhantes deste tipo usarão esta categoria. O histórico não foi alterado.');setAberto(false);setPrevia(null);router.refresh();
  }catch(e){setErro(`${mensagemDeErro(e)} Se os dados mudaram, consulte uma nova prévia.`);}finally{setOcupado(false);}
 }
 return <div className="min-w-0 max-w-full text-sm">
  <button type="button" className="botao-fantasma text-xs" aria-expanded={aberto} onClick={()=>setAberto(!aberto)}>Criar regra</button>
  {aberto&&<fieldset disabled={ocupado} className="mt-3 grid min-w-0 gap-3 rounded border p-3" style={{borderColor:'var(--borda)'}}>
   <legend>Revisar regra pessoal</legend>
   <p>O texto será procurado literalmente nas próximas movimentações do mesmo tipo. A categoria atual será mantida. Menor prioridade numérica vence.</p>
   <label className="grid gap-1">Texto a reconhecer<input className="campo-soberano w-full min-w-0" value={padrao} onChange={e=>{setPadrao(e.target.value);invalidar();}}/></label>
   <p className="text-xs">Use entre 3 e 200 caracteres. Edite o texto para remover datas e números que mudam.</p>
   <label className="grid gap-1">Prioridade da regra<input className="campo-soberano w-full min-w-0" type="number" min={0} max={100000} step={1} value={prioridade} onChange={e=>{setPrioridade(e.target.value);invalidar();}}/></label>
   <button type="button" className="botao-fantasma justify-self-start" disabled={!valido||ocupado} onClick={consultar}>Ver prévia</button>
   {previa&&<div className="grid min-w-0 gap-2" aria-live="polite">
    <p>{previa.total} movimentação(ões) de {previa.tipo==='RECEITA'?'receita':'despesa'} correspondem ao texto. Amostra de até 20; o histórico não será reclassificado.</p>
    <ul className="grid gap-1">{previa.exemplos.map(e=><li className="break-words" key={e.id}>{e.descricao}</li>)}</ul>
    {previa.amplo&&<p>Texto muito curto: pode alcançar movimentações diferentes. Prefira um nome mais específico.</p>}
    {previa.conflito&&<p role="alert">{previa.conflito} <Link href="/categorias" className="underline">Revisar regras existentes</Link></p>}
    <label className="flex items-start gap-2"><input type="checkbox" checked={conferido} onChange={e=>setConferido(e.target.checked)}/><span>Conferi o texto, os exemplos e a categoria escolhida.</span></label>
    <button type="button" className="botao-soberano justify-self-start" disabled={!conferido||!!previa.conflito||ocupado} onClick={salvar}>Salvar regra pessoal</button>
   </div>}
  </fieldset>}
  {erro&&<p role="alert">{erro}</p>}{aviso&&<p role="status">{aviso}</p>}
 </div>;
}
