'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import {useRouter} from 'next/navigation';
import {createClient} from '@/lib/supabase/client';
import {hojeSaoPaulo} from '@/lib/data';
import {formatarData,formatarCentavos,paraCentavos,centavosParaDecimalEditavel} from '@/lib/money';
import {mensagemDeErro} from '@/lib/erros';
import {validarPartes,type OcorrenciaReceita} from '@/lib/receitas-recorrentes';
import {useConfirm} from '@/components/feedback';

type Categoria={id:string;nome:string;tipo:string};
type Resposta={error:unknown};
export default function ReceitasRecorrentes({categorias}:{categorias:Categoria[]}){
 const router=useRouter();const confirmar=useConfirm();
 const [mes,setMes]=useState(()=>hojeSaoPaulo().slice(0,7));const [linhas,setLinhas]=useState<OcorrenciaReceita[]>([]);
 const [erro,setErro]=useState<string|null>(null);const [aviso,setAviso]=useState('');const [pendente,setPendente]=useState(false);const [carregando,setCarregando]=useState(true);
 const [selecao,setSelecao]=useState<string[]>([]);const [aberto,setAberto]=useState(false);const [recebendo,setRecebendo]=useState(false);
 const [descricao,setDescricao]=useState('');const [forma,setForma]=useState('TRANSFERENCIA');const [inicio,setInicio]=useState(hojeSaoPaulo);const [categoria,setCategoria]=useState('');
 const [partes,setPartes]=useState([{dia:'15',valor:''},{dia:'30',valor:''}]);
 const [data,setData]=useState(hojeSaoPaulo);const [total,setTotal]=useState('');const [observacao,setObservacao]=useState('');const [motivo,setMotivo]=useState('');
 const chaveCriacao=useRef<string|null>(null);const chaveConfirmacao=useRef<string|null>(null);const emOperacao=useRef(false);const versao=useRef(0);
 const carregar=useCallback(()=>{
  const atual=++versao.current;
  return Promise.resolve(createClient().rpc('consultar_receitas_previstas',{p_mes:mes+'-01'}).abortSignal(AbortSignal.timeout(15000)))
   .then(({data,error})=>{if(error)throw error;if(atual===versao.current)setLinhas(data as unknown as OcorrenciaReceita[]);})
   .catch(e=>{if(atual===versao.current)setErro(mensagemDeErro(e));})
   .finally(()=>{if(atual===versao.current)setCarregando(false);});
 },[mes]);
 useEffect(()=>{const estado=versao;void carregar();return()=>{estado.current++;};},[carregar]);
 async function operar(acao:()=>PromiseLike<Resposta>,mensagem:string){
  if(emOperacao.current)return false;emOperacao.current=true;setPendente(true);setErro(null);setAviso('');
  try{const {error}=await acao();if(error)throw error;setAviso(mensagem);setCarregando(true);await carregar();router.refresh();window.dispatchEvent(new Event('receitas-recorrentes-alteradas'));return true;}
  catch(e){setErro(mensagemDeErro(e));return false;}finally{emOperacao.current=false;setPendente(false);}
 }
 async function criar(e:React.FormEvent){
  e.preventDefault();const valores=partes.map(p=>({dia:Number(p.dia),valor:paraCentavos(p.valor)}));
  try{validarPartes(valores);}catch(e){setErro(mensagemDeErro(e));return;}
  chaveCriacao.current??=crypto.randomUUID();
  const ok=await operar(()=>createClient().rpc('criar_receitas_previstas',{p_chave:chaveCriacao.current!,p_descricao:descricao.trim(),p_forma:forma,p_inicio:inicio,p_partes:valores,p_categoria_id:categoria||null}).abortSignal(AbortSignal.timeout(15000)),'Receita programada. O caixa só muda após confirmar o recebimento.');
  if(ok){chaveCriacao.current=null;setAberto(false);setDescricao('');setPartes([{dia:'15',valor:''},{dia:'30',valor:''}]);}
 }
 async function receber(e:React.FormEvent){
  e.preventDefault();const valor=paraCentavos(total);if(!Number.isSafeInteger(valor)||valor<=0){setErro('Informe o total positivo efetivamente recebido.');return;}
  chaveConfirmacao.current??=crypto.randomUUID();
  const ok=await operar(()=>createClient().rpc('confirmar_receitas_previstas',{p_chave:chaveConfirmacao.current!,p_ids:selecao,p_data:data,p_valor:valor,p_observacao:observacao.trim()||null}).abortSignal(AbortSignal.timeout(15000)),'Recebimento registrado uma única vez no caixa.');
  if(ok){setRecebendo(false);setSelecao([]);chaveConfirmacao.current=null;setObservacao('');}
 }
 async function desfazer(tx:string){
  if(!await confirmar({titulo:'Desfazer recebimento',mensagem:'A entrada será retirada do caixa e todas as datas deste recebimento voltarão para revisão. Vínculos bancários e períodos fechados precisam ser resolvidos antes.',rotuloConfirmar:'Desfazer recebimento',perigo:true}))return;
  await operar(()=>createClient().rpc('desfazer_receita_prevista',{p_transacao_id:tx}).abortSignal(AbortSignal.timeout(15000)),'Recebimento desfeito; confira as datas novamente.');
 }
 const escolhidas=linhas.filter(l=>selecao.includes(l.id));
 return <section id="receitas-recorrentes" aria-labelledby="titulo-receitas-recorrentes" className="vidro-soberano grid min-w-0 gap-4 p-4" style={{scrollMarginTop:'10rem'}}>
  <header><h2 id="titulo-receitas-recorrentes" className="serifa text-xl">Receitas recorrentes</h2><p className="mt-1 text-sm">O que você espera receber fica previsto. Somente o recebimento confirmado aumenta o caixa.</p></header>
  <div className="flex flex-wrap items-end justify-between gap-3">
   <label className="text-sm">Mês de referência<input type="month" min="2000-01" max="2099-12" value={mes} disabled={pendente||recebendo} className="campo-soberano" onChange={e=>{if(e.target.value){setMes(e.target.value);setErro(null);setCarregando(true);setLinhas([]);setSelecao([]);}}}/></label>
   <button type="button" className="botao-fantasma text-sm" disabled={pendente||recebendo} onClick={()=>setAberto(!aberto)}>{aberto?'Fechar cadastro':'Programar receita recorrente'}</button>
  </div>
  {aberto&&<form aria-label="Programar receita recorrente" onSubmit={criar} className="grid min-w-0 gap-3">
   <fieldset disabled={pendente} className="grid min-w-0 gap-3 sm:grid-cols-2">
    <p className="sm:col-span-2 text-sm" style={{color:'var(--verde)'}}>Tipo: Receita · partes mensais</p>
    <label className="text-sm">Descrição da receita<input required maxLength={200} value={descricao} onChange={e=>setDescricao(e.target.value)} className="campo-soberano" placeholder="Ex.: Salário"/></label>
    <label className="text-sm">Forma de recebimento recorrente<select className="campo-soberano" value={forma} onChange={e=>setForma(e.target.value)}><option value="TRANSFERENCIA">Transferência</option><option value="PIX">Pix</option><option value="DINHEIRO">Dinheiro</option></select></label>
    <label className="text-sm">Prever a partir de<input required type="date" min="2000-01-01" max="2099-12-31" value={inicio} onChange={e=>setInicio(e.target.value)} className="campo-soberano"/></label>
    <label className="text-sm">Categoria da receita<select className="campo-soberano" value={categoria} onChange={e=>setCategoria(e.target.value)}><option value="">Automática</option>{categorias.filter(c=>c.tipo==='RECEITA').map(c=><option key={c.id} value={c.id}>{c.nome}</option>)}</select></label>
    {partes.map((p,i)=><div key={i} className="grid min-w-0 gap-2 sm:col-span-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_auto]">
     <label className="text-sm">Dia da parte {i+1}<input required type="number" min={1} max={31} value={p.dia} onChange={e=>setPartes(ps=>ps.map((p,j)=>j===i?{...p,dia:e.target.value}:p))} className="campo-soberano"/></label>
     <label className="text-sm">Valor da parte {i+1} (R$)<input required inputMode="decimal" value={p.valor} onChange={e=>setPartes(ps=>ps.map((p,j)=>j===i?{...p,valor:e.target.value}:p))} className="campo-soberano"/></label>
     <button type="button" disabled={partes.length===1} className="botao-fantasma self-end text-sm" onClick={()=>setPartes(ps=>ps.filter((_,j)=>j!==i))}>Remover parte {i+1}</button>
    </div>)}
    <button type="button" disabled={partes.length>=31} className="botao-fantasma justify-self-start text-sm" onClick={()=>setPartes(ps=>[...ps,{dia:'',valor:''}])}>Adicionar outra data</button>
   </fieldset>
   <p className="text-xs">Se o dia não existir, usamos o último dia do mês. Em março, o dia contratado volta ao normal. Transferência entre contas próprias não é receita.</p>
   <button disabled={pendente} className="botao-soberano justify-self-start text-sm">Salvar programação</button>
  </form>}
  {carregando?<p role="status">Carregando previsões…</p>:<>
   {!linhas.length&&<p className="text-sm">Nenhuma receita prevista neste mês. Consulte meses anteriores para revisar pendências.</p>}
   <ul className="grid min-w-0 gap-3">{linhas.map(l=><li key={l.id} className="grid min-w-0 gap-2 rounded-lg border p-3" style={{borderColor:'var(--borda)'}}>
    <div className="flex flex-wrap items-center gap-2">
     {l.status==='PREVISTA'&&<input type="checkbox" aria-label={`Selecionar ${l.descricao} em ${formatarData(l.data_prevista)}`} disabled={pendente||recebendo} checked={selecao.includes(l.id)} onChange={e=>setSelecao(xs=>e.target.checked?[...xs,l.id]:xs.filter(x=>x!==l.id))}/>}
     <strong className="break-words">{l.descricao}</strong><span className="numero-soberano">{formatarCentavos(l.valor)}</span><span className="text-sm">{formatarData(l.data_prevista)}</span>
     <span className="text-sm" style={{color:l.status==='RECEBIDA'?'var(--verde)':'var(--grafite)'}}>{l.status==='RECEBIDA'?'Recebida':l.status==='PULADA'?'Não recebida':'Prevista'}</span>
    </div>
    {l.motivo&&<p className="break-words text-sm">{l.motivo}</p>}
    {l.status==='PREVISTA'&&<div className="flex flex-wrap gap-2"><button type="button" disabled={pendente||recebendo} className="botao-fantasma text-sm" onClick={()=>{setSelecao([l.id]);setTotal(centavosParaDecimalEditavel(l.valor));setRecebendo(true);chaveConfirmacao.current=null;}}>Confirmar esta entrada</button><button type="button" disabled={pendente||recebendo} className="botao-fantasma text-sm" onClick={()=>void operar(()=>createClient().rpc('marcar_receita_nao_recebida',{p_id:l.id,p_pular:true,p_motivo:motivo.trim()||null}).abortSignal(AbortSignal.timeout(15000)),'Ocorrência pulada. Os próximos meses continuam previstos.')}>Não recebi nesta data</button></div>}
    {l.status==='PULADA'&&<button type="button" disabled={pendente||recebendo} className="botao-fantasma justify-self-start text-sm" onClick={()=>void operar(()=>createClient().rpc('marcar_receita_nao_recebida',{p_id:l.id,p_pular:false,p_motivo:null}).abortSignal(AbortSignal.timeout(15000)),'Ocorrência devolvida à revisão.')}>Desfazer marcação</button>}
    {l.status==='RECEBIDA'&&l.transacao_id&&<button type="button" disabled={pendente||recebendo} className="botao-fantasma justify-self-start text-sm" onClick={()=>void desfazer(l.transacao_id!)}>Desfazer recebimento</button>}
   </li>)}</ul>
  </>}
  {!recebendo&&<div className="grid gap-3">
   <label className="text-sm">Motivo para não receber (opcional)<input maxLength={2000} className="campo-soberano" value={motivo} onChange={e=>setMotivo(e.target.value)} placeholder="Ex.: férias, recebi antecipado"/></label>
   <button type="button" disabled={pendente||carregando||!selecao.length} className="botao-fantasma justify-self-start text-sm" onClick={()=>{setTotal(centavosParaDecimalEditavel(escolhidas.reduce((n,l)=>n+l.valor,0)));setRecebendo(true);chaveConfirmacao.current=null;}}>Recebi juntas/antecipado</button>
  </div>}
  {recebendo&&<form aria-label="Confirmar receita prevista" onSubmit={receber} className="grid min-w-0 gap-3 rounded-lg border p-3" style={{borderColor:'var(--verde)'}}>
   <p className="text-sm">Confirmar {escolhidas.length} ocorrência(s) em uma única entrada: {escolhidas.map(l=>`${l.descricao} (${formatarData(l.data_prevista)})`).join(', ')}.</p>
   <fieldset disabled={pendente} className="grid min-w-0 gap-3 sm:grid-cols-2">
    <label className="text-sm">Data efetivamente recebida<input required type="date" min="2000-01-01" max={hojeSaoPaulo()} value={data} onChange={e=>setData(e.target.value)} className="campo-soberano"/></label>
    <label className="text-sm">Total recebido (R$)<input required inputMode="decimal" value={total} onChange={e=>setTotal(e.target.value)} className="campo-soberano"/></label>
    <label className="text-sm sm:col-span-2">Observação do recebimento<textarea maxLength={2000} value={observacao} onChange={e=>setObservacao(e.target.value)} className="campo-soberano"/></label>
   </fieldset>
   <div className="flex flex-wrap gap-2"><button disabled={pendente} className="botao-soberano text-sm">Confirmar recebimento</button><button type="button" disabled={pendente} className="botao-fantasma text-sm" onClick={()=>setRecebendo(false)}>Voltar à revisão</button></div>
  </form>}
  {erro&&<p role="alert" className="break-words text-sm" style={{color:'var(--telha)'}}>{erro}</p>}{aviso&&<p role="status" className="text-sm">{aviso}</p>}
  {erro&&<button type="button" disabled={pendente} onClick={()=>{setErro(null);void carregar();}} className="botao-fantasma justify-self-start text-sm">Atualizar revisão</button>}
  <p className="text-xs">Nas férias: confirme as partes recebidas juntas na data real ou marque apenas a data sem recebimento. Pausar a regra em Recorrências interrompe novas previsões; não apaga o histórico. Os valores desta lista são os previstos; confira o total real em Transações.</p>
 </section>;
}
