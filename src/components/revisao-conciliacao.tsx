"use client";
import {useState} from 'react';
import {createClient} from '@/lib/supabase/client';
import {mensagemDeErro} from '@/lib/erros';
import {formatarCentavos} from '@/lib/money';
import {candidatosParaLinha,type LinhaBancaria,type DetalheConta} from '@/lib/conciliacao-bancaria';

function Linha({linha,detalhe,atualizar}:{linha:LinhaBancaria;detalhe:DetalheConta;atualizar:()=>void}) {
 const [escolha,setEscolha]=useState('');const [erro,setErro]=useState('');const [pendente,setPendente]=useState(false);
 const finalizada=linha.movimento_id!==null||linha.ignorada;
 const candidatos=candidatosParaLinha(linha,detalhe.candidatos);
 const faturas=(detalhe.faturas??[]).filter(f=>linha.valor===-f.valor&&Math.abs(Date.parse(f.data)-Date.parse(linha.data))<=3*86400000);
 const transferencias=detalhe.movimentos.filter(m=>m.transferencia_id&&m.valor===linha.valor&&Math.abs(Date.parse(m.data)-Date.parse(linha.data))<=3*86400000&&!detalhe.linhas.some(l=>l.movimento_id===m.id));
 async function executar(desfazer=false) {
  setErro('');setPendente(true);
  try{
   const db=createClient();const [acao,id]=escolha.split(':');
   const {error}=desfazer?await db.rpc('desfazer_conciliacao_conta',{p_linha_id:linha.id}):await db.rpc('conciliar_linha_conta',{p_linha_id:linha.id,p_acao:acao,p_transacao_id:acao==='VINCULAR'?id:null,p_movimento_id:acao==='TRANSFERENCIA'?id:null,p_fatura_id:acao==='FATURA'?id:null});
   if(error)throw error;atualizar();
  }catch(e){setErro(mensagemDeErro(e));}finally{setPendente(false);}
 }
 return <section className="min-w-0 rounded-xl border p-4" style={{borderColor:'var(--borda)'}} aria-label={`Movimentação ${linha.descricao}`}>
  <div className="flex flex-wrap justify-between gap-2"><p className="min-w-0 break-words font-medium">{linha.descricao}</p><span className="numero-soberano shrink-0">{formatarCentavos(linha.valor)}</span></div>
  <p className="mt-2 text-sm">{linha.data.split('-').reverse().join('/')} · {linha.ignorada?'Ignorada na revisão':linha.movimento_id?'Conciliada':'A conferir'}</p>
  {linha.ambigua&&!finalizada&&<p className="mt-2 text-sm" style={{color:'var(--ouro)'}}>Existe outra linha com a mesma data, valor e descrição. Confira se é outra compra ou uma repetição de arquivo.</p>}
  {finalizada?<button className="botao-fantasma mt-3" disabled={pendente} onClick={()=>void executar(true)}>Desfazer conferência</button>:<div className="mt-3 grid gap-3"><label className="text-sm">Como tratar esta movimentação<select className="campo-soberano" value={escolha} onChange={e=>setEscolha(e.target.value)}><option value="">Escolha após conferir</option>{candidatos.map(t=><option key={t.id} value={'VINCULAR:'+t.id}>Vincular: {t.descricao} · {t.data_compra}{t.natureza==='LIQUIDACAO_FATURA'?' · quitação de fatura':''}</option>)}{faturas.map(f=><option key={f.id} value={'FATURA:'+f.id}>Quitação: {f.descricao} · {f.data}</option>)}{transferencias.map(t=><option key={t.id} value={'TRANSFERENCIA:'+t.id}>Transferência própria: {t.descricao}</option>)}<option value="NOVA">Registrar nova {linha.valor<0?'despesa':'receita'}</option><option value="IGNORAR">Ignorar: confirme que não deve entrar nesta conferência</option></select></label><button className="botao-fantasma justify-self-start" disabled={!escolha||pendente} onClick={()=>void executar()}>{pendente?'Conferindo…':'Confirmar tratamento'}</button></div>}
  {erro&&<p role="alert" className="mt-3 text-sm">{erro}</p>}
 </section>;
}
export default function RevisaoConciliacao({detalhe,atualizar}:{detalhe:DetalheConta;atualizar:()=>void}) {
 return <section className="grid min-w-0 gap-3" aria-label="Conferência do extrato"><h2 className="serifa text-xl">Conferência do extrato</h2><p className="text-sm">Confira cada vínculo. Pagamentos de cartão devem ser vinculados à quitação registrada em Contas a pagar. Para Pix entre contas suas, registre primeiro a transferência.</p>{detalhe.linhas.length?detalhe.linhas.map(l=><Linha key={l.id+String(l.movimento_id)+String(l.ignorada)} linha={l} detalhe={detalhe} atualizar={atualizar}/>):<p>Nenhuma movimentação bancária recebida neste período.</p>}</section>;
}
