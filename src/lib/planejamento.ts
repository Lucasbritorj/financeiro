import type { PeriodicidadeAssinatura, StatusAssinatura } from './assinaturas.ts';

export type CartaoPlanejamento = { id: string; nome: string; dia_fechamento: number };
export type AssinaturaPlanejamento = {
 id: string; descricao: string; valor: number; periodicidade: PeriodicidadeAssinatura;
 status: StatusAssinatura; proxima_data: string; dia_do_mes: number; cartao_id: string | null;
};
export type ParcelaPlanejamento = { id: string; cartao_id: string; competencia: string; valor: number };
export type CobrancaPlanejamento = ParcelaPlanejamento & { assinatura_id: string | null; data: string };
export type ContaAlerta = { id: string; descricao: string; data_vencimento: string; valor: number };
type GrupoCartao = {
 id: string; nome: string; registrado: number; parcelasPrevistas: number;
 assinaturasPrevistas: number; comprometido: number;
};
export type MesPlanejamento = { mes: string; cartoes: GrupoCartao[]; semCartao: number; total: number };
const ciclos: Record<PeriodicidadeAssinatura, number> = { MENSAL:1, TRIMESTRAL:3, SEMESTRAL:6, ANUAL:12 };
const indiceMes = (mes: string) => Number(mes.slice(0,4))*12+Number(mes.slice(5,7))-1;
const mesNoIndice = (indice: number) => `${Math.floor(indice/12).toString().padStart(4,'0')}-${(indice%12+1).toString().padStart(2,'0')}`;
const diasNoMes = (indice: number) => new Date(Date.UTC(Math.floor(indice/12),indice%12+1,0)).getUTCDate();
const normalizar = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\s+/g,' ').trim();
function somar(a:number,b:number):number {
 const total=a+b;
 if(!Number.isSafeInteger(a)||!Number.isSafeInteger(b)||!Number.isSafeInteger(total))throw new Error('Total acima do limite de precisão em centavos. Reduza o período ou confira os valores.');
 return total;
}

function agenda(assinatura: AssinaturaPlanejamento, inicio: number, fim: number): string[] {
 const base = indiceMes(assinatura.proxima_data);
 const ciclo = ciclos[assinatura.periodicidade];
 const primeira = Math.max(0,Math.floor((inicio-base)/ciclo));
 const datas: string[] = [];
 for (let n=primeira; base+n*ciclo<fim; n++) {
  const mes=base+n*ciclo;
  const dia=Math.min(assinatura.dia_do_mes,diasNoMes(mes));
  const data=`${mesNoIndice(mes)}-${dia.toString().padStart(2,'0')}`;
  if(data>=assinatura.proxima_data) datas.push(data);
 }
 return datas;
}

/** Não cria faturas/lançamentos. Os valores são centavos e todas as partes permanecem separadas. */
export function montarPlanejamento(args: {
 mes: string; cartoes: readonly CartaoPlanejamento[]; parcelas: readonly ParcelaPlanejamento[];
 previsoes: readonly ParcelaPlanejamento[]; assinaturas: readonly AssinaturaPlanejamento[];
 cobrancas: readonly CobrancaPlanejamento[];
}): MesPlanejamento[] {
 if(!/^(20\d{2})-(0[1-9]|1[0-2])$/.test(args.mes)) throw new Error('Escolha um mês entre 2000 e 2099.');
 const inicio=indiceMes(args.mes);
 const meses=Array.from({length:12},(_,i)=>({mes:mesNoIndice(inicio+i),cartoes:args.cartoes.map(c=>({id:c.id,nome:c.nome,registrado:0,parcelasPrevistas:0,assinaturasPrevistas:0,comprometido:0})),semCartao:0,total:0}));
 const mesesPorChave=new Map(meses.map(m=>[m.mes,m]));
 const grupos=new Map(meses.flatMap(m=>m.cartoes.map(c=>[`${m.mes}:${c.id}`,c] as const)));
 for(const [linhas,campo] of [[args.parcelas,'registrado'],[args.previsoes,'parcelasPrevistas']] as const) {
  for(const linha of linhas) {
   const grupo=grupos.get(`${linha.competencia.slice(0,7)}:${linha.cartao_id}`);
   if(grupo) grupo[campo]=somar(grupo[campo],linha.valor);
  }
 }
 aplicarAssinaturas(args,inicio,mesesPorChave,grupos);
 for(const mes of meses) {
  for(const c of mes.cartoes) c.comprometido=somar(somar(c.registrado,c.parcelasPrevistas),c.assinaturasPrevistas);
  mes.total=mes.cartoes.reduce((s,c)=>somar(s,c.comprometido),mes.semCartao);
 }
 return meses;
}
function aplicarAssinaturas(args:Parameters<typeof montarPlanejamento>[0],inicio:number,mesesPorChave:Map<string,MesPlanejamento>,grupos:Map<string,GrupoCartao>) {
 const cartoesPorId=new Map(args.cartoes.map(c=>[c.id,c]));
 const confirmadas=new Set(args.cobrancas.filter(c=>c.assinatura_id).map(c=>`${c.assinatura_id}:${c.competencia.slice(0,7)}`));
 for(const assinatura of args.assinaturas.filter(a=>a.status==='ATIVA')) {
  const cartao=assinatura.cartao_id ? cartoesPorId.get(assinatura.cartao_id) : null;
  // A competência segue o corte usado pelo registro manual de compras no cartão.
  for(const data of agenda(assinatura,inicio-1,inicio+12)) {
   const mesCompra=indiceMes(data);
   const mes=mesNoIndice(mesCompra+(cartao&&Number(data.slice(8))>=Math.min(cartao.dia_fechamento,diasNoMes(mesCompra))?1:0));
   const item=mesesPorChave.get(mes);
   if(!item||confirmadas.has(`${assinatura.id}:${mes}`)) continue;
   if(!assinatura.cartao_id) item.semCartao=somar(item.semCartao,assinatura.valor);
   else { const grupo=grupos.get(`${mes}:${assinatura.cartao_id}`); if(grupo)grupo.assinaturasPrevistas=somar(grupo.assinaturasPrevistas,assinatura.valor); }
  }
 }
}

export type AlertaFinanceiro = {
 id: string; tipo: 'VENCIMENTO'|'ASSINATURA'|'AUMENTO'|'DUPLICIDADE';
 titulo: string; detalhe: string; href: string; valor: number; data?: string; atrasado?: boolean;
};
function alertaDeAumento(a:AssinaturaPlanejamento,cobrancas:readonly CobrancaPlanejamento[],hoje:string):AlertaFinanceiro|null {
 const porMes=new Map<string,number>();
 for(const c of cobrancas.filter(c=>c.assinatura_id===a.id&&c.competencia.slice(0,7)<=hoje.slice(0,7)))porMes.set(c.competencia,somar(porMes.get(c.competencia)??0,c.valor));
 const meses=[...porMes.keys()].sort().reverse();
 if(meses.length<2||porMes.get(meses[0])!<=porMes.get(meses[1])!)return null;
 return {id:`aumento:${a.id}`,tipo:'AUMENTO',titulo:`Possível aumento · ${a.descricao}`,valor:porMes.get(meses[0])!,data:meses[0],href:'/assinaturas',detalhe:'O total vinculado no último mês supera o mês anterior. Confira valor e quantidade de cobranças.'};
}
export function gerarAlertas(args: {
 hoje: string; contas: readonly ContaAlerta[]; assinaturas: readonly AssinaturaPlanejamento[];
 cobrancas: readonly CobrancaPlanejamento[];
}): AlertaFinanceiro[] {
 const fim=new Date(`${args.hoje}T12:00:00Z`);fim.setUTCDate(fim.getUTCDate()+7);
 const limite=fim.toISOString().slice(0,10);const alertas: AlertaFinanceiro[]=[];
 for(const conta of args.contas.filter(c=>c.data_vencimento<=limite&&c.valor>0)) alertas.push({
  id:`conta:${conta.id}`,tipo:'VENCIMENTO',titulo:conta.descricao,valor:conta.valor,
  data:conta.data_vencimento,atrasado:conta.data_vencimento<args.hoje,href:'/faturas',
  detalhe:conta.data_vencimento<args.hoje?'Vencimento passou; confira a baixa.':'Vence nos próximos 7 dias.',
 });
 const ativas=args.assinaturas.filter(a=>a.status==='ATIVA');
 const grupos=new Map<string,AssinaturaPlanejamento[]>();
 for(const a of ativas) {
  if(a.proxima_data<=limite) alertas.push({id:`assinatura:${a.id}`,tipo:'ASSINATURA',titulo:a.descricao,valor:a.valor,data:a.proxima_data,href:'/assinaturas',detalhe:a.proxima_data<args.hoje?'Agenda da assinatura precisa ser conferida.':'Cobrança prevista nos próximos 7 dias.'});
  const chave=JSON.stringify([a.cartao_id,normalizar(a.descricao)]);
  const grupo=grupos.get(chave)??[];grupo.push(a);grupos.set(chave,grupo);
  const aumento=alertaDeAumento(a,args.cobrancas,args.hoje);if(aumento)alertas.push(aumento);
 }
 for(const grupo of grupos.values()) if(grupo.length>1)alertas.push({id:`duplicidade:${grupo.map(a=>a.id).sort().join(':')}`,tipo:'DUPLICIDADE',titulo:`Possível duplicidade · ${grupo[0].descricao}`,valor:grupo.reduce((s,a)=>somar(s,a.valor),0),href:'/assinaturas',detalhe:`${grupo.length} contratos ativos com mesmo nome e cartão. Confira antes de cancelar; os valores podem ter periodicidades diferentes.`});
 return alertas.sort((a,b)=>(a.data??'9999').localeCompare(b.data??'9999')||a.id.localeCompare(b.id));
}
