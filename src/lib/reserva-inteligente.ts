import { mesesAte } from './cofrinhos.ts';

// Teto também aplicado no banco; mantém somas intermediárias exatas em centavos.
export const LIMITE_RESERVA = 1_000_000_000_000;
export type PreferenciasReserva = {
 intencao:number; margem:number; caixa:number|null; compromissos:number;
 receita:number|null; gasto:number|null; prioridades:Record<string,number>;
};
export const PREFERENCIAS_INICIAIS:PreferenciasReserva={intencao:0,margem:0,caixa:null,compromissos:0,receita:null,gasto:null,prioridades:{}};
function dinheiro(v:unknown):asserts v is number {
 if(typeof v!=='number'||!Number.isSafeInteger(v)||v<0||v>LIMITE_RESERVA)throw new Error('Informe valores inteiros em centavos dentro do limite.');
}
function somar(a:number,b:number):number {
 const n=a+b;if(!Number.isSafeInteger(n))throw new Error('Total acima do limite de precisão.');return n;
}
export function validarPreferencias(v:unknown):PreferenciasReserva {
 if(!v||typeof v!=='object'||Array.isArray(v))throw new Error('Preferências inválidas.');
 const p=v as Record<string,unknown>;
 const chaves=['intencao','margem','caixa','compromissos','receita','gasto','prioridades'];
 if(Object.keys(p).length!==chaves.length||Object.keys(p).some(k=>!chaves.includes(k)))throw new Error('Campos de preferências inválidos.');
 for(const k of ['intencao','margem','compromissos'])dinheiro(p[k]);
 for(const k of ['caixa','receita','gasto'])if(p[k]!==null)dinheiro(p[k]);
 if(!p.prioridades||typeof p.prioridades!=='object'||Array.isArray(p.prioridades)||Object.keys(p.prioridades).length>200)throw new Error('Prioridades inválidas.');
 for(const [id,n] of Object.entries(p.prioridades))if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)||![1,2,3].includes(n as number))throw new Error('Prioridade inválida.');
 return p as PreferenciasReserva;
}
export type MovimentoReserva={data_compra:string;valor_total:number;tipo:string;natureza:string};
export function reservadoNoMes(movimentos:readonly {data:string;valor:number;tipo:string}[],hoje:string) {
 let total=0;
 for(const m of movimentos)if(m.data.slice(0,7)===hoje.slice(0,7)&&m.data<=hoje){
  dinheiro(m.valor);if(!['APORTE','RESGATE'].includes(m.tipo))throw new Error('Movimento de reserva inválido.');
  total=somar(total,m.tipo==='APORTE'?m.valor:-m.valor);
 }
 return total;
}
export function basesHistoricas(linhas:readonly MovimentoReserva[],meses:readonly string[]) {
 if(meses.length!==3||new Set(meses).size!==3)throw new Error('São necessários três meses distintos.');
 const valores=meses.map(mes=>{
  let receita=0,gasto=0;
  for(const l of linhas)if(l.data_compra.slice(0,7)===mes&&l.natureza==='CONSUMO'){
   dinheiro(l.valor_total);
   if(l.tipo==='RECEITA')receita=somar(receita,l.valor_total);
   if(l.tipo==='DESPESA')gasto=somar(gasto,l.valor_total);
  }
  return {receita,gasto};
 });
 return {receita:Math.min(...valores.map(v=>v.receita)),gasto:Math.max(...valores.map(v=>v.gasto))};
}
export function calcularReserva(p:Omit<PreferenciasReserva,'prioridades'>,pisoGasto:number,jaReservado=0) {
 for(const n of [p.intencao,p.margem,p.compromissos,pisoGasto,jaReservado])dinheiro(n);
 for(const n of [p.caixa,p.receita,p.gasto])if(n!==null)dinheiro(n);
 const gasto=p.gasto===null?null:Math.max(p.gasto,pisoGasto);
 const capacidadeMensal=p.receita===null||gasto===null?null:Math.max(0,p.receita-gasto-p.margem-jaReservado);
 const capacidadeCaixa=p.caixa===null?null:Math.max(0,p.caixa-p.compromissos-p.margem);
 const intencaoRestante=Math.max(0,p.intencao-jaReservado);
 const reserva=capacidadeMensal===null||capacidadeCaixa===null?null:Math.min(intencaoRestante,capacidadeMensal,capacidadeCaixa);
 return {reserva,capacidadeMensal,capacidadeCaixa,gasto,deficit:reserva===null?null:intencaoRestante-reserva};
}
export type MetaReserva={id:string;valor_alvo:number;saldo_atual:number;data_alvo:string|null;prioridade:number};
export function distribuirReserva(valor:number,metas:readonly MetaReserva[],hoje:string) {
 dinheiro(valor);
 const ids=new Set<string>();
 for(const m of metas){dinheiro(m.valor_alvo);dinheiro(m.saldo_atual);if(ids.has(m.id)||![1,2,3].includes(m.prioridade))throw new Error('Meta inválida.');ids.add(m.id);}
 const ordem=[...metas].sort((a,b)=>a.prioridade-b.prioridade||(a.data_alvo??'9999').localeCompare(b.data_alvo??'9999')||a.id.localeCompare(b.id));
 const resultado=new Map(metas.map(m=>[m.id,0]));let restante=valor;
 // Primeiro atende a necessidade do mês por prioridade; depois antecipa metas.
 for(const etapa of [1,2])for(const m of ordem){
  const falta=Math.max(0,m.valor_alvo-m.saldo_atual-resultado.get(m.id)!);
  const necessidade=etapa===2?falta:m.data_alvo?Math.ceil(falta/(m.data_alvo<=hoje?1:mesesAte(hoje,m.data_alvo))):0;
  const aporte=Math.min(restante,falta,necessidade);
  resultado.set(m.id,resultado.get(m.id)!+aporte);restante-=aporte;
 }
 return metas.map(m=>({id:m.id,valor:resultado.get(m.id)!}));
}
type ContaCobertura={id:string;nome:string;data_inicial:string;fechado_ate:string|null};
export function coberturaMes(mes:string,contas:readonly ContaCobertura[],cartoes:readonly {id:string;nome:string}[],lotes:readonly {cartao_id:string;competencia:string}[],pendencias:readonly {conta_id:string;data:string}[]) {
 if(!/^20\d{2}-(0[1-9]|1[0-2])$/.test(mes))throw new Error('Mês inválido.');
 const [ano,m]=mes.split('-').map(Number);const fim=new Date(Date.UTC(ano,m,0)).toISOString().slice(0,10);
 const faltas:string[]=[];
 if(!contas.length)faltas.push('Cadastre e confira suas contas bancárias.');
 for(const c of contas)if(c.data_inicial>mes+'-01'||!c.fechado_ate||c.fechado_ate<fim||pendencias.some(p=>p.conta_id===c.id&&p.data.slice(0,7)===mes))faltas.push(`Conferir extrato de ${c.nome}.`);
 for(const c of cartoes)if(!lotes.some(l=>l.cartao_id===c.id&&l.competencia.slice(0,7)===mes))faltas.push(`Conferir fatura de ${c.nome}.`);
 return {mes,completo:faltas.length===0,faltas};
}
