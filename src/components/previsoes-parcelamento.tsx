"use client";
import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { lerTodasPaginas } from '@/lib/leitura-paginada';
import { mensagemDeErro } from '@/lib/erros';
import { formatarCentavos, paraCentavos, centavosParaDecimalEditavel } from '@/lib/money';
import type { Database } from '@/lib/database.types';
type Previsao=Database['public']['Views']['vw_previsoes_parcelamento']['Row'];
export default function PrevisoesParcelamento({cartaoId}:{cartaoId:string}) {
 const [linhas,setLinhas]=useState<Previsao[]|null>(null);const [erro,setErro]=useState<string|null>(null);const [pendente,setPendente]=useState(false);
 async function carregar() {
  const db=createClient();
  const result=await lerTodasPaginas<Previsao>((id,n)=>{let q=db.from('vw_previsoes_parcelamento').select('*').eq('cartao_id',cartaoId);if(id)q=q.gt('id',id);return q.order('id').limit(n);});
  setLinhas(result);
 }
 async function consultar() {setPendente(true);setErro(null);setLinhas(null);try{await carregar();}catch(e){setErro(mensagemDeErro(e));}finally{setPendente(false);}}
 async function editar(id:string,entrada:string) {
  const valor=paraCentavos(entrada);if(!valor){setErro('Informe um valor previsto positivo.');return;}
  setPendente(true);setErro(null);
  try{const {error}=await createClient().rpc('editar_previsao_parcelamento',{p_plano_id:id,p_valor:valor});if(error)throw error;await carregar();}catch(e){setErro(mensagemDeErro(e));}finally{setPendente(false);}
 }
 const grupos=Map.groupBy(linhas??[],l=>l.plano_id);
 return <section className="vidro-soberano grid gap-3 p-5" aria-label="Previsões de parcelas">
  <h2 className="serifa text-lg">Parcelas previstas</h2>
  <p className="text-xs">Estimativas dos parcelamentos importados. Não entram nos gastos efetivos; a próxima fatura confirma cada cobrança.</p>
  <button className="botao-fantasma" disabled={!cartaoId||pendente} onClick={()=>void consultar()}>{pendente?'Consultando…':'Consultar previsões deste cartão'}</button>
  {erro&&<p role="alert" style={{color:'var(--telha)'}}>{erro}</p>}
  {linhas?.length===0&&<p role="status">Nenhuma parcela prevista para este cartão.</p>}
  {linhas&&linhas.length>0&&<p className="text-sm">{linhas.length} parcela(s) prevista(s) · {formatarCentavos(linhas.reduce((s,l)=>s+l.valor,0))}</p>}
  {[...grupos].map(([id,parcelas])=><form key={id} className="grid gap-2 border-t pt-3" style={{borderColor:'var(--borda)'}} onSubmit={e=>{e.preventDefault();void editar(id,String(new FormData(e.currentTarget).get('valor')));}}>
   <p className="break-words text-sm font-medium">{parcelas[0].descricao}</p>
   <p className="text-xs">{parcelas.sort((a,b)=>a.numero-b.numero).map(p=>`${p.numero}ª: ${p.competencia.slice(0,7)}`).join(' · ')}</p>
   <label className="text-sm">Valor previsto por parcela (R$)<input name="valor" className="campo-soberano" inputMode="decimal" required defaultValue={centavosParaDecimalEditavel(parcelas[0].valor)} key={parcelas[0].valor}/></label>
   <button className="botao-fantasma" disabled={pendente}>Atualizar somente previsões</button>
  </form>)}
 </section>;
}
