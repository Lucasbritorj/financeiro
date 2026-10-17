import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './database.types';
import { lerTodasPaginas } from './leitura-paginada';
import { deslocarMes } from './insights';
import { gerarAlertas, montarPlanejamento, type AssinaturaPlanejamento } from './planejamento';

type DB=SupabaseClient<Database>;
async function assinaturasAtivas(db:DB):Promise<AssinaturaPlanejamento[]> {
 const linhas=await lerTodasPaginas((cursor,n)=>{
  let q=db.from('recorrencias').select('id,descricao,valor,periodicidade,status,proxima_data,dia_do_mes,cartao_id').eq('finalidade','ASSINATURA').eq('status','ATIVA').order('id').limit(n);
  if(cursor)q=q.gt('id',cursor);return q;
 });
 return linhas.map(l=>{
  if(!l.periodicidade||!['MENSAL','TRIMESTRAL','SEMESTRAL','ANUAL'].includes(l.periodicidade))throw new Error('Periodicidade não reconhecida. Confira os contratos.');
  return {...l,periodicidade:l.periodicidade as AssinaturaPlanejamento['periodicidade'],status:'ATIVA'};
 });
}
async function cobrancas(db:DB,fim:string) {
 return lerTodasPaginas((cursor,n)=>{
  let q=db.from('vw_cobrancas_assinaturas').select('*').lt('competencia',fim).order('id').limit(n);
  if(cursor)q=q.gt('id',cursor);return q;
 });
}
async function contasProximas(db:DB,hoje:string) {
 const limite=new Date(`${hoje}T12:00:00Z`);limite.setUTCDate(limite.getUTCDate()+7);
 // A view não possui id único: BOLETO e FATURA usam prefixos diferentes.
 const linhas:Database['public']['Views']['vw_contas_a_pagar']['Row'][]=[];
 for(const tipo of ['BOLETO','FATURA']) {
  let cursor:string|null=null;
  for(;;){
   let q=db.from('vw_contas_a_pagar').select('*').eq('tipo',tipo).lte('data_vencimento',limite.toISOString().slice(0,10)).order('origem_id').limit(500);
   if(cursor)q=q.gt('origem_id',cursor);
   const {data,error}=await q;if(error)throw error;if(!data)throw new Error('Consulta de contas sem resposta.');
   if(data.length===0)break;
   const proximo=data[data.length-1].origem_id;if(cursor&&proximo<=cursor)throw new Error('Consulta de contas não avançou.');
   linhas.push(...data);cursor=proximo;if(linhas.length>100000)throw new Error('Há mais de 100 mil contas; reduza o histórico.');
  }
 }
 return linhas.map(l=>({...l,id:`${l.tipo}:${l.origem_id}`}));
}
export async function consultarAlertas(db:DB,hoje:string) {
 // Histórico completo vinculado: uma assinatura anual pode precisar de mais de 12 meses para comparar duas cobranças.
 const [assinaturas,historico,contas]=await Promise.all([assinaturasAtivas(db),cobrancas(db,deslocarMes(hoje.slice(0,7),1)+'-01'),contasProximas(db,hoje)]);
 return gerarAlertas({hoje,assinaturas,cobrancas:historico,contas});
}
export async function consultarPlanejamento(db:DB,mes:string,hoje:string) {
 if(!/^20\d{2}-(0[1-9]|1[0-2])$/.test(mes))throw new Error('Mês inválido.');
 const inicio=mes+'-01',fim=deslocarMes(mes,12)+'-01';
 const historicoFim=deslocarMes(hoje.slice(0,7),1)+'-01';
 const [cartoes,parcelas,previsoes,assinaturas,historico,contas]=await Promise.all([
  lerTodasPaginas(cursorCartoes(db)),
  lerTodasPaginas((cursor,n)=>{let q=db.from('vw_parcelas_planejamento').select('*').gte('competencia',inicio).lt('competencia',fim).order('id').limit(n);if(cursor)q=q.gt('id',cursor);return q;}),
  lerTodasPaginas((cursor,n)=>{let q=db.from('vw_previsoes_parcelamento').select('*').gte('competencia',inicio).lt('competencia',fim).order('id').limit(n);if(cursor)q=q.gt('id',cursor);return q;}),
  assinaturasAtivas(db),cobrancas(db,fim>historicoFim?fim:historicoFim),contasProximas(db,hoje),
 ]);
 return {meses:montarPlanejamento({mes,cartoes,parcelas,previsoes,assinaturas,cobrancas:historico}),alertas:gerarAlertas({hoje,assinaturas,cobrancas:historico,contas})};
}
function cursorCartoes(db:DB) {
 return (cursor:string|null,n:number)=>{let q=db.from('cartoes_credito').select('id,nome,dia_fechamento').order('id').limit(n);if(cursor)q=q.gt('id',cursor);return q;};
}
