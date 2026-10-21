'use client';
import {explicarSugestao} from '@/lib/previsao-caixa';

import { useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { formatarCentavos, centavosParaDecimalEditavel } from '@/lib/money';
import { lerCentavosComZero } from '@/lib/orcamentos-mensais';
import { mensagemDeErro } from '@/lib/erros';
import { calcularReserva, distribuirReserva, validarPreferencias, type PreferenciasReserva, type MetaReserva } from '@/lib/reserva-inteligente';
import type { DadosReserva } from '@/lib/reserva-consulta';

type Campo='intencao'|'margem'|'caixa'|'compromissos'|'receita'|'gasto';
const ROTULOS:Record<Campo,string>={intencao:'Quanto desejo guardar por mês',margem:'Margem de segurança',caixa:'Caixa livre hoje, sem os cofrinhos',compromissos:'Compromissos ainda a pagar neste mês',receita:'Receita mensal para simulação',gasto:'Gasto mensal para simulação'};
const CAMPOS:Campo[]=['intencao','margem','caixa','compromissos','receita','gasto'];
type Meta=Omit<MetaReserva,'prioridade'>&{nome:string;reservadoMes?:number};

export default function ReservaInteligente({dados,metas,hoje,reservadoTotalMes}:{dados:DadosReserva;metas:Meta[];hoje:string;reservadoTotalMes?:number}) {
 const [campos,setCampos]=useState(()=>Object.fromEntries(CAMPOS.map(k=>[k,dados.preferencias[k]===null?'':centavosParaDecimalEditavel(dados.preferencias[k]!)])) as Record<Campo,string>);
 const [prioridades,setPrioridades]=useState<Record<string,number>>(()=>Object.fromEntries(metas.map(m=>[m.id,dados.preferencias.prioridades[m.id]??2])));
 const [salvando,setSalvando]=useState(false);const [aviso,setAviso]=useState('');const [erro,setErro]=useState('');
 const [conferido,setConferido]=useState(false);
 function preferencias():PreferenciasReserva {
  const valores:Record<string,number|null>={};
  for(const k of CAMPOS){
   if(campos[k].trim()===''&&['caixa','receita','gasto'].includes(k)){valores[k]=null;continue;}
   const n=lerCentavosComZero(campos[k]);
   if(n===null)throw new Error(`Confira o campo: ${ROTULOS[k]}.`);valores[k]=n;
  }
  return validarPreferencias({...valores,prioridades});
 }
 let p:PreferenciasReserva|null=null;let erroCalculo='';
 try{p=preferencias();}catch(e){erroCalculo=mensagemDeErro(e);}
 const simulacao=!dados.bases||p?.receita!==null||p?.gasto!==null;
 let calculo:ReturnType<typeof calcularReserva>|null=null;
 let distribuicao:ReturnType<typeof distribuirReserva>=[];
 const reservadoMes=reservadoTotalMes??Math.max(0,metas.reduce((s,m)=>s+(m.reservadoMes??0),0));
 if(p)try{
  calculo=calcularReserva({...p,receita:p.receita??dados.bases?.receita??null,gasto:p.gasto??dados.bases?.gasto??null},dados.pisoGasto,reservadoMes);
  if(calculo.reserva!==null)distribuicao=distribuirReserva(calculo.reserva,metas.map(m=>({...m,prioridade:prioridades[m.id]??2})),hoje);
 }catch(e){erroCalculo=mensagemDeErro(e);}
 const pronto=conferido&&calculo?.reserva!==null&&calculo!==null&&!erroCalculo;
 const total=distribuicao.reduce((s,m)=>s+m.valor,0);
 async function salvar(e:React.FormEvent){
  e.preventDefault();setErro('');setAviso('');setSalvando(true);
  try{
   const preferenciasValidadas=preferencias();
   const {error}=await createClient().rpc('salvar_preferencias_reserva',{p_dados:preferenciasValidadas}).abortSignal(AbortSignal.timeout(15000));
   if(error)throw error;setAviso('Preferências salvas. Nenhum aporte foi realizado.');
  }catch(e){setErro(mensagemDeErro(e));}finally{setSalvando(false);}
 }
 return <section aria-labelledby="titulo-reserva" className="vidro-soberano grid min-w-0 grid-cols-1 gap-6 p-5 md:p-6">
  <header className="grid gap-2"><h2 id="titulo-reserva" className="serifa text-2xl">Quanto posso reservar?</h2><p className="text-sm">Defina sua intenção e distribua uma reserva possível entre suas metas. As sugestões não movimentam dinheiro.</p></header>
  {dados.sugestaoCaixa?<div className="grid gap-2 text-sm"><p>Valores conhecidos em {dados.sugestaoCaixa.data}: caixa calculado livre {formatarCentavos(dados.sugestaoCaixa.caixa)}; compromissos ainda previstos para este mês {formatarCentavos(dados.sugestaoCaixa.compromissos)}. Receitas futuras não financiam o aporte de hoje.</p><button type="button" className="botao-fantasma justify-self-start" onClick={()=>{setCampos(c=>({...c,caixa:centavosParaDecimalEditavel(Math.max(0,dados.sugestaoCaixa!.caixa)),compromissos:centavosParaDecimalEditavel(dados.sugestaoCaixa!.compromissos)}));setConferido(false);setAviso('Valores carregados para revisão. Caixa calculado não substitui saldo bancário; se negativo, a disponibilidade para reserva é zero. Nenhum aporte foi realizado.');}}>Carregar valores conhecidos para conferir</button></div>:<p className="text-sm">Carregamento assistido indisponível. Você pode conferir e preencher os valores manualmente.</p>}
  <details className="text-sm"><summary className="cursor-pointer">Histórico dos três meses anteriores</summary>
   <p className="my-3">Inclua todas as suas contas, como Bradesco e Itaú, e seus cartões. Conferência dos cadastros não detecta fontes ausentes nem garante classificação correta.</p>
   <ul className="grid gap-2">{dados.cobertura.map(m=><li key={m.mes}><strong>{m.mes}: {m.completo?'cobertura mínima atendida':'faltam conferências'}</strong>{m.faltas.map(f=><p key={f}>{f}</p>)}</li>)}</ul>
   <div className="mt-3 flex flex-wrap gap-4"><Link className="underline" href="/contas">Conferir contas</Link><Link className="underline" href="/importar">Importar faturas</Link></div>
  </details>
  <form onSubmit={salvar} className="grid min-w-0 grid-cols-1 gap-4">
   <div className="grid gap-4 md:grid-cols-2">{CAMPOS.map(k=><label key={k} className="grid min-w-0 gap-1 text-sm">{ROTULOS[k]} (R$)<input className="campo-soberano w-full min-w-0" inputMode="decimal" maxLength={20} value={campos[k]} onChange={e=>{setCampos({...campos,[k]:e.target.value});setAviso('');setConferido(false);}} placeholder={['receita','gasto'].includes(k)?'Vazio = usar histórico conferido':k==='caixa'?'Informe seu caixa disponível':'0,00'}/></label>)}</div>
   <p className="text-sm" style={{color:'var(--grafite)'}}>O caixa livre deve excluir valores já reservados. Confira todos os pagamentos que ainda sairão neste mês, inclusive os que ainda não cadastrou. O carregamento assistido usa os registros do aplicativo; confirme com seus saldos bancários.</p>
   <fieldset className="grid gap-3"><legend className="mb-2 font-medium">Prioridade dos cofrinhos</legend>{metas.length===0?<p>Crie um cofrinho para receber uma distribuição.</p>:metas.map(m=><label key={m.id} className="flex min-w-0 flex-wrap items-center justify-between gap-2 text-sm"><span className="min-w-0 break-words">{m.nome}</span><select className="campo-soberano max-w-full" aria-label={`Prioridade de ${m.nome}`} value={prioridades[m.id]??2} onChange={e=>{setPrioridades({...prioridades,[m.id]:Number(e.target.value)});setAviso('');}}><option value={1}>Alta</option><option value={2}>Média</option><option value={3}>Baixa</option></select></label>)}</fieldset>
   <button className="botao-fantasma justify-self-start" disabled={salvando}>{salvando?'Salvando…':'Salvar preferências'}</button>
   <p className="text-xs">Preferências ficam na sua conta. Se você salvar em duas abas, vale a última gravação.</p>
   {dados.atualizadoEm&&<p className="text-xs">Última gravação: {dados.atualizadoEm.slice(0,10)}. Confira novamente caixa e compromissos.</p>}
  </form>
  {erro&&<p role="alert">{erro}</p>}{aviso&&<p role="status">{aviso}</p>}
  {erroCalculo&&<p role="alert">{erroCalculo}</p>}
  <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={conferido} onChange={e=>setConferido(e.target.checked)}/><span>Conferi o caixa livre, os compromissos e as fontes usadas neste cálculo.</span></label>
  <div aria-live="polite" className="grid gap-3 border-t pt-4" style={{borderColor:'var(--borda)'}}>
   <h3 className="serifa text-xl">{simulacao?'Simulação':'Estimativa com histórico conferido'}</h3>
   {!pronto?<p>{calculo?.reserva===null?'Faltam dados: informe caixa, receita e gasto para simular, ou conclua as conferências do histórico.':'Confira os dados acima para visualizar a sugestão.'}</p>:<>
    <p className="numero-soberano text-2xl" style={{color:'var(--verde)'}}>{formatarCentavos(calculo!.reserva!)} disponíveis para esta proposta</p>
    <dl className="grid gap-2 text-sm"><div><dt>Capacidade mensal após margem</dt><dd>{formatarCentavos(calculo!.capacidadeMensal!)}</dd></div><div><dt>Caixa após compromissos e margem</dt><dd>{formatarCentavos(calculo!.capacidadeCaixa!)}</dd></div><div><dt>Falta para sua intenção mensal</dt><dd>{formatarCentavos(calculo!.deficit!)}</dd></div></dl>
    <p className="text-sm">Já reservado líquido neste mês: {formatarCentavos(reservadoMes)}. A sugestão considera apenas a intenção e a capacidade restantes.</p>
    <ul className="grid gap-2">{metas.map(m=><li key={m.id} className="flex flex-wrap justify-between gap-2 border-b pb-2 text-sm" style={{borderColor:'var(--borda)'}}><span className="min-w-0 break-words">{m.nome}<small className="block">Reservado líquido no mês: {formatarCentavos(m.reservadoMes??0)}</small><small className="block">{explicarSugestao(m,distribuicao.find(d=>d.id===m.id)?.valor??0)}</small></span><strong className="numero-soberano">Sugerido agora: {formatarCentavos(distribuicao.find(d=>d.id===m.id)?.valor??0)}</strong></li>)}</ul>
    <p className="text-sm">Distribuído: {formatarCentavos(total)}. Sem destino nas metas atuais: {formatarCentavos(calculo!.reserva!-total)}.</p>
    <p className="text-sm">A ordem considera prioridade, prazo e contribuição necessária. O restante pode antecipar metas até seu valor alvo. Registre somente o que realmente reservar, nos controles de aporte abaixo.</p>
   </>}
   <p className="text-xs">{dados.bases?`Histórico: menor receita mensal ${formatarCentavos(dados.bases.receita)} e maior gasto mensal ${formatarCentavos(dados.bases.gasto)}.`:'Histórico incompleto: não tratamos meses sem dados como meses sem gastos.'} Piso de gastos conhecidos em cartões e assinaturas no mês: {formatarCentavos(dados.pisoGasto)}; usamos o maior valor entre ele e o gasto-base, sem somá-los novamente.</p>
   <p className="text-xs">Sem previsão de rendimentos. Receita observada não significa renda garantida; confira bônus, reembolsos e despesas excepcionais. Três meses não cobrem todos os gastos anuais.</p>
  </div>
 </section>;
}
