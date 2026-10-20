import {formatarCentavos} from './money.ts';
export type EventoCaixa={id:string;data:string;valor:number;tipo:'ENTRADA'|'SAIDA';descricao:string;situacao:'PREVISTA'|'REGISTRADA'|'ESTIMADA';origem:string};
function dinheiro(n:number){if(!Number.isSafeInteger(n))throw new Error('Valor financeiro fora do limite de precisão.');}
function dataValida(s:string){if(!/^20\d{2}-\d{2}-\d{2}$/.test(s)||!Number.isFinite(Date.parse(s))||new Date(s).toISOString().slice(0,10)!==s)throw new Error('Data inválida na previsão.');}
export function calcularFluxo(base:number,eventos:readonly EventoCaixa[],hoje:string,fim:string){
 dinheiro(base);dataValida(hoje);dataValida(fim);if(fim<hoje)throw new Error('Período inválido.');
 const ids=new Set<string>();const porData=new Map<string,{data:string;entradas:number;saidas:number;eventos:EventoCaixa[]}>();let receitasAtrasadas=0;
 for(const e of eventos){
  dataValida(e.data);dinheiro(e.valor);if(e.valor<0||!['ENTRADA','SAIDA'].includes(e.tipo)||ids.has(e.id))throw new Error('Evento inválido ou duplicado na previsão.');ids.add(e.id);
  if(e.data<hoje&&e.tipo==='ENTRADA'){receitasAtrasadas++;continue;}const data=e.data<hoje?hoje:e.data;if(data>fim)continue;
  const d=porData.get(data)??{data,entradas:0,saidas:0,eventos:[]};
  if(e.tipo==='ENTRADA')d.entradas+=e.valor;else d.saidas+=e.valor;dinheiro(d.entradas);dinheiro(d.saidas);d.eventos.push(e);porData.set(data,d);
 }
 let saldo=base,minimo=base,dataMinimo=hoje,compromissosMes=0;
 const dias=[...porData.values()].sort((a,b)=>a.data.localeCompare(b.data)).map(d=>{
  saldo+=d.entradas-d.saidas;dinheiro(saldo);if(saldo<minimo){minimo=saldo;dataMinimo=d.data;}
  if(d.data.slice(0,7)===hoje.slice(0,7)){compromissosMes+=d.saidas;dinheiro(compromissosMes);}
  return {...d,saldo};
 });
 return {base,final:saldo,minimo,dataMinimo,dias,compromissosMes,receitasAtrasadas};
}
export function explicarSugestao(meta:{valor_alvo:number;saldo_atual:number},valor:number){
 if(meta.saldo_atual>=meta.valor_alvo)return 'Meta concluída; não precisa de novo aporte.';
 if(valor===0)return 'Sem valor nesta proposta: capacidade disponível e prioridades atendem outras necessidades primeiro.';
 return `Sugestão de ${formatarCentavos(valor)}, limitada pela capacidade, prioridade e valor que falta para a meta.`;
}
