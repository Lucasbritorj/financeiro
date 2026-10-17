"use client";
import { useState } from 'react';
import { formatarCentavos, centavosParaDecimalEditavel, paraCentavos } from '@/lib/money';
import { resumoFatura, type LinhaFatura, type TipoLinhaFatura } from '@/lib/importacao-fatura';
import type { CategoriaOpcao } from './importador-csv/tabela-revisao';
import type { useImportacaoFatura } from './use-importacao-fatura';

type Fluxo=ReturnType<typeof useImportacaoFatura>;
function Linha({l,index,fluxo,categorias}:{l:LinhaFatura;index:number;fluxo:Fluxo;categorias:CategoriaOpcao[]}) {
 const alterar=(patch:Partial<LinhaFatura>)=>fluxo.alterar(index,patch);
 const especiais=l.tipo==='INFORMATIVO'||l.tipo==='AJUSTE';
 return <fieldset className="grid min-w-0 gap-3 rounded-xl border p-4" style={{borderColor:'var(--borda)'}} disabled={fluxo.pendente}>
  <legend className="px-2 font-medium">Linha {index+1} · {formatarCentavos(l.valor)}</legend>
  <p className="break-words text-xs" style={{color:'var(--grafite)'}}>No arquivo: {l.original}</p>
  <p className="break-words text-sm">{l.motivo}</p>
  <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={l.ignorar} onChange={e=>alterar({ignorar:e.target.checked})}/>Não importar esta linha</label>
  {l.natureza_valor==='DESCONHECIDA'&&<label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={l.sinal_confirmado} onChange={e=>alterar({sinal_confirmado:e.target.checked})}/>Conferi o sinal no arquivo: este valor é uma despesa do cartão.</label>}
  {!especiais&&<div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
   <label className="text-sm">Tipo da linha {index+1}<select className="campo-soberano" value={l.tipo} onChange={e=>alterar({tipo:e.target.value as TipoLinhaFatura})}>
    <option value="GASTO">Gasto comum</option><option value="PARCELA">Compra parcelada</option><option value="ASSINATURA">Possível assinatura</option></select></label>
   <label className="text-sm">Descrição da linha {index+1}<input className="campo-soberano" value={l.descricao} maxLength={500} onChange={e=>alterar({descricao:e.target.value})}/></label>
   <label className="text-sm">Data da linha {index+1}<input type="date" className="campo-soberano" value={l.data} onChange={e=>alterar({data:e.target.value})}/></label>
   <label className="text-sm">Valor da linha {index+1} (R$)<input className="campo-soberano" inputMode="decimal" key={l.valor} defaultValue={centavosParaDecimalEditavel(l.valor)} onBlur={e=>{const valor=paraCentavos(e.target.value);if(valor!==l.valor)alterar({valor:valor??0});}}/></label>
   <label className="text-sm">Categoria da linha {index+1}<select className="campo-soberano" value={l.categoria_id??''} onChange={e=>alterar({categoria_id:e.target.value||null})}>
    <option value="">Sem categoria</option>{categorias.filter(c=>c.tipo==='DESPESA').map(c=><option key={c.id} value={c.id}>{c.nome}</option>)}</select></label>
  </div>}
  {!especiais&&l.data_confirmada!==undefined&&<label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={l.data_confirmada} onChange={e=>alterar({data_confirmada:e.target.checked})}/>Conferi a data sugerida da linha {index+1}, incluindo o ano.</label>}
  {l.tipo==='PARCELA'&&<div className="grid gap-3 sm:grid-cols-3">
   <label className="text-sm">Parcela atual da linha {index+1}<input className="campo-soberano" type="number" min="1" max="120" value={l.parcela_numero} onChange={e=>alterar({parcela_numero:Number(e.target.value)})}/></label>
   <label className="text-sm">Total de parcelas da linha {index+1}<input className="campo-soberano" type="number" min="2" max="120" value={l.parcelas_total} onChange={e=>alterar({parcelas_total:Number(e.target.value)})}/></label>
   <label className="text-sm">Vínculo da linha {index+1}<select className="campo-soberano" value={l.plano_id??''} onChange={e=>alterar({plano_id:e.target.value||null})}>
    <option value="">Novo parcelamento</option>{fluxo.planos.map(p=><option key={p.id} value={p.id}>{p.descricao} · {p.parcelas_total} parcelas</option>)}</select></label>
   <label className="text-sm">Valor previsto por parcela da linha {index+1} (R$)<input className="campo-soberano" inputMode="decimal" key={l.valor_previsto??l.valor} defaultValue={centavosParaDecimalEditavel(l.valor_previsto??l.valor)} onBlur={e=>{const valor=paraCentavos(e.target.value)??0;if(valor!==(l.valor_previsto??l.valor))alterar({valor_previsto:valor});}}/></label>
   {l.previsao_original&&<p className="break-words text-xs sm:col-span-3">Previsão no arquivo: {l.previsao_original}. Esse valor afeta somente as parcelas futuras.</p>}
  </div>}
  {l.tipo==='ASSINATURA'&&<div className="grid gap-3 sm:grid-cols-2">
   <label className="text-sm">Decisão sobre assinatura da linha {index+1}<select className="campo-soberano" value={l.decisao_assinatura} onChange={e=>alterar({decisao_assinatura:e.target.value as LinhaFatura['decisao_assinatura']})}>
    <option value="PENDENTE">Escolha antes de confirmar</option><option value="NOVA">Criar assinatura</option><option value="VINCULAR">Vincular à existente</option><option value="NAO">É somente um gasto</option></select></label>
   {l.decisao_assinatura==='VINCULAR'&&<label className="text-sm">Assinatura existente da linha {index+1}<select className="campo-soberano" value={l.assinatura_id??''} onChange={e=>alterar({assinatura_id:e.target.value||null})}>
    <option value="">Selecione</option>{fluxo.contratos.map(a=><option key={a.id} value={a.id}>{a.descricao}</option>)}</select></label>}
   {l.decisao_assinatura==='NOVA'&&<>
    <label className="text-sm">Periodicidade da linha {index+1}<select className="campo-soberano" value={l.periodicidade} onChange={e=>alterar({periodicidade:e.target.value as LinhaFatura['periodicidade']})}>
     <option value="MENSAL">Mensal</option><option value="TRIMESTRAL">Trimestral</option><option value="SEMESTRAL">Semestral</option><option value="ANUAL">Anual</option></select></label>
    <label className="text-sm">Próxima cobrança da linha {index+1}<input className="campo-soberano" type="date" value={l.proxima_cobranca} onChange={e=>alterar({proxima_cobranca:e.target.value})}/></label>
   </>}
  </div>}
  {!especiais&&<label className="flex items-start gap-2 text-xs"><input type="checkbox" checked={l.decisao_duplicidade==='NOVA'} onChange={e=>alterar({decisao_duplicidade:e.target.checked?'NOVA':'PENDENTE'})}/>Conferi os registros semelhantes: esta é uma cobrança nova{l.tipo==='PARCELA'&&!l.plano_id?' e um novo parcelamento':''}.</label>}
 </fieldset>;
}
export function RevisaoFatura({fluxo,categorias,cartaoNome}:{fluxo:Fluxo;categorias:CategoriaOpcao[];cartaoNome:string}) {
 const [somenteDatas,setSomenteDatas]=useState(false);
 const [datasConferidas,setDatasConferidas]=useState<string|null>(null);
 const r=fluxo.revisao;if(!r)return null;
 const pendentes=r.linhas.filter(l=>!l.ignorar&&l.tipo!=='INFORMATIVO'&&l.tipo!=='AJUSTE'&&l.data_confirmada===false).length;
 const resumo=resumoFatura(r.linhas);const diferenca=r.total_informado!==null&&r.total_informado!==resumo.cobrancas;
 return <section className="grid min-w-0 gap-5" aria-label="Revisão da fatura">
  <div className="vidro-soberano grid gap-3 p-5">
   <h2 className="serifa text-xl">Confira a fatura · {cartaoNome} · {r.competencia}</h2>
   <p className="text-sm">Cobranças selecionadas: <strong>{formatarCentavos(resumo.cobrancas)}</strong>. Novas previsões de parcelas: {formatarCentavos(resumo.previsoes)}.</p>
   <p className="text-sm">Ajustes pendentes: {formatarCentavos(resumo.ajustes)} · {resumo.ignoradas} linha(s) excluída(s) · {r.descartadas} linha(s) não reconhecida(s).</p>
   {r.total_informado!==null&&<p className="text-sm">Total informado no arquivo: {formatarCentavos(r.total_informado)}.</p>}
   {diferenca&&<p role="alert" style={{color:'var(--telha)'}}>Diferença: {formatarCentavos(Math.abs(resumo.cobrancas-r.total_informado!))}. {r.origem==='PDF'?'Corrija os valores ou a seleção para fechar o total antes de importar.':'Confira os valores antes de importar.'}</p>}
   {(r.origem!=='PDF'||r.total_extraido===null)&&<label className="text-sm">Total da fatura para conferência (R$, opcional)<input className="campo-soberano" inputMode="decimal" defaultValue={r.total_informado===null?'':centavosParaDecimalEditavel(r.total_informado)} onBlur={e=>fluxo.alterarTotal(e.target.value.trim()===''?null:paraCentavos(e.target.value))}/></label>}
   {((diferenca&&r.origem!=='PDF')||r.descartadas>0)&&<label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={fluxo.conferido} onChange={e=>fluxo.setConferido(e.target.checked)}/>Conferi a diferença de total e as linhas não reconhecidas. Quero importar somente as cobranças selecionadas.</label>}
   {r.linhas.some(l=>!l.ignorar&&l.data_confirmada===false)&&<p className="border-l-2 pl-3 text-sm" style={{borderColor:'var(--ouro)',color:'var(--grafite)'}}>O PDF não informa o ano de todas as compras. Confira as datas sugeridas em cada linha; o encargo usa uma data de referência.</p>}
   <p className="text-xs" style={{color:'var(--grafite)'}}>Parcelas futuras são estimativas; meses anteriores não serão recriados. Assinaturas controlam contratos e não criam outra despesa. Créditos e estornos precisam ser excluídos explicitamente nesta versão.</p>
  </div>
  <section className="vidro-soberano grid gap-3 p-5" aria-label="Conferência de datas">
   <h3 className="serifa text-lg">Datas para conferir: {pendentes}</h3>
   <p className="text-sm">Confira o dia, mês e ano de cada compra selecionada. Encargos usam uma data de referência. Se precisar corrigir, edite a data da linha.</p>
   <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={somenteDatas} onChange={e=>setSomenteDatas(e.target.checked)}/>Mostrar somente datas pendentes</label>
   {pendentes>0&&<><label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={datasConferidas===r.chave} onChange={e=>setDatasConferidas(e.target.checked?r.chave:null)} disabled={fluxo.pendente}/>Conferi as datas pendentes das compras selecionadas, incluindo o ano.</label>
   <button type="button" className="botao-fantasma justify-self-start" disabled={datasConferidas!==r.chave||fluxo.pendente} onClick={()=>{fluxo.confirmarDatas();setDatasConferidas(null);}}>Confirmar as {pendentes} datas conferidas</button></>}
   {somenteDatas&&pendentes===0&&<p role="status">Todas as datas selecionadas foram conferidas. Desmarque o filtro para continuar a revisão completa.</p>}
  </section>
  {r.linhas.map((l,i)=>(!somenteDatas||(!l.ignorar&&l.tipo!=='INFORMATIVO'&&l.tipo!=='AJUSTE'&&l.data_confirmada===false))&&<Linha key={i} l={l} index={i} fluxo={fluxo} categorias={categorias}/>)}
  {fluxo.erro&&<p role="alert" style={{color:'var(--telha)'}}>{fluxo.erro}</p>}
  <div className="flex flex-wrap gap-3"><button className="botao-soberano" disabled={fluxo.pendente} onClick={()=>void fluxo.confirmar()}>{fluxo.pendente?'Confirmando…':'Confirmar importação da fatura'}</button>
   <button className="botao-fantasma" disabled={fluxo.pendente} onClick={fluxo.descartar}>Descartar revisão</button></div>
 </section>;
}
