'use client';
import {useState} from 'react';
import Link from 'next/link';
import {calcularFluxo} from '@/lib/previsao-caixa';
import type {DadosPrevisao} from '@/lib/previsao-consulta';
import {formatarCentavos,formatarData,centavosParaDecimalEditavel,paraCentavosAssinado} from '@/lib/money';
export default function PrevisaoSaldo({dados}:{dados:DadosPrevisao}){
 const [base,setBase]=useState(()=>centavosParaDecimalEditavel(dados.livre)),[conferido,setConferido]=useState(false);
 const valor=/^[+-]?0([,.]0{1,2})?$/.test(base.trim())?0:paraCentavosAssinado(base);
 let fluxo:ReturnType<typeof calcularFluxo>|null=null,erro='';
 try{if(valor===null)throw new Error('Confira o saldo-base.');fluxo=calcularFluxo(valor,dados.eventos,dados.hoje,dados.fim);}catch(e){erro=e instanceof Error?e.message:'Não foi possível calcular.';}
 return <section aria-labelledby="titulo-previsao-saldo" className="vidro-soberano grid min-w-0 gap-4 p-5">
  <header><h2 id="titulo-previsao-saldo" className="serifa text-2xl">Previsão de saldo · próximos 90 dias</h2><p className="mt-2 text-sm">Simulação por data de recebimento e pagamento. Previsões não aumentam seu caixa real.</p></header>
  <dl className="grid min-w-0 gap-3 sm:grid-cols-2"><div><dt>Caixa calculado no aplicativo</dt><dd className="numero-soberano text-xl">{formatarCentavos(dados.caixa)}</dd></div><div><dt>Já separado nos cofrinhos</dt><dd className="numero-soberano text-xl">{formatarCentavos(dados.reservado)}</dd></div></dl>
  <p className="text-sm">Base de {formatarData(dados.hoje)}: lançamentos e pagamentos registrados, menos cofrinhos, inclusive arquivados. Não é consulta do saldo bancário. Fontes ausentes, compras novas e gastos variáveis futuros podem mudar o resultado.</p>
  <label className="text-sm">Saldo-base livre para simulação (R$)<input className="campo-soberano" inputMode="decimal" maxLength={22} value={base} onChange={e=>{setBase(e.target.value);setConferido(false);}}/></label>
  <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={conferido} onChange={e=>setConferido(e.target.checked)}/><span>Conferi o saldo-base e entendo que receitas esperadas ainda não foram recebidas.</span></label>
  {erro&&<p role="alert">{erro}</p>}
  {!conferido?<p>Confira a base para visualizar a projeção.</p>:fluxo&&<>
   <dl className="grid min-w-0 gap-3 sm:grid-cols-2"><div><dt>Saldo projetado em {formatarData(dados.fim)}</dt><dd className="numero-soberano text-2xl">{formatarCentavos(fluxo.final)}</dd></div><div><dt>Menor saldo diário · {formatarData(fluxo.dataMinimo)}</dt><dd className="numero-soberano text-2xl" style={{color:fluxo.minimo<0?'var(--telha)':'var(--verde)'}}>{formatarCentavos(fluxo.minimo)}</dd></div></dl>
   {fluxo.minimo<0&&<p role="status" style={{color:'var(--telha)'}}>Pode faltar dinheiro antes do próximo recebimento. Confira as datas, não apenas o total do mês.</p>}
   {fluxo.receitasAtrasadas>0&&<p>{fluxo.receitasAtrasadas} receita(s) anterior(es) nesta janela aguardam revisão e não foram presumidas recebidas hoje.</p>}
   <p className="text-xs">Compromissos vencidos são pendências no primeiro dia da simulação. Saldo diário não garante ordem de operações dentro do dia. Confira assinaturas sem vínculo explícito com lançamentos.</p>
   {fluxo.dias.length===0&&<p>Nenhum evento conhecido. Isso não significa ausência de gastos futuros.</p>}
   <div className="grid min-w-0 gap-2">{fluxo.dias.map(d=><details key={d.data} className="min-w-0 border-t pt-3" style={{borderColor:'var(--borda)'}}><summary className="cursor-pointer break-words text-sm">{formatarData(d.data)} · entradas {formatarCentavos(d.entradas)} · saídas {formatarCentavos(d.saidas)} · saldo {formatarCentavos(d.saldo)}</summary><ul className="mt-2 grid gap-2 text-sm">{d.eventos.map(e=><li key={e.id} className="break-words"><Link className="underline" href={e.origem}>{e.descricao}</Link> · {e.tipo==='ENTRADA'?'+':'−'}{formatarCentavos(e.valor)} · {e.situacao==='REGISTRADA'?'Compromisso registrado':e.situacao==='ESTIMADA'?'Estimado':'Previsto'}{e.data<dados.hoje?` · data original ${formatarData(e.data)}`:''}</li>)}</ul></details>)}</div>
  </>}
 </section>;
}
