import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './database.types';
import { lerTodasPaginas } from './leitura-paginada';
import { deslocarMes } from './insights';
import { montarPlanejamento, type AssinaturaPlanejamento } from './planejamento';
import { basesHistoricas, coberturaMes, PREFERENCIAS_INICIAIS, validarPreferencias } from './reserva-inteligente';
import {consultarPrevisao} from './previsao-consulta';

export async function consultarReserva(db:SupabaseClient<Database>,hoje:string) {
 const mes=hoje.slice(0,7),inicio=deslocarMes(mes,-3)+'-01';
 const meses=[-3,-2,-1].map(n=>deslocarMes(mes,n));
 const fim=deslocarMes(mes,1)+'-01';
 const [preferencias,contas,cartoes,lotes,pendentes,movimentos,parcelas,previsoes,recorrencias,cobrancas]=await Promise.all([
  db.from('preferencias_reserva').select('dados,updated_at').abortSignal(AbortSignal.timeout(15000)).maybeSingle(),
  lerTodasPaginas((cursor,n)=>{let q=db.from('contas_bancarias').select('id,nome,data_inicial,fechado_ate').order('id').limit(n);if(cursor)q=q.gt('id',cursor);return q.abortSignal(AbortSignal.timeout(15000));}),
  lerTodasPaginas((cursor,n)=>{let q=db.from('cartoes_credito').select('id,nome,dia_fechamento').is('deleted_at',null).order('id').limit(n);if(cursor)q=q.gt('id',cursor);return q.abortSignal(AbortSignal.timeout(15000));}),
  lerTodasPaginas((cursor,n)=>{let q=db.from('lotes_fatura').select('id,cartao_id,competencia').is('desfeita_em',null).gte('competencia',inicio).lt('competencia',mes+'-01').order('id').limit(n);if(cursor)q=q.gt('id',cursor);return q.abortSignal(AbortSignal.timeout(15000));}),
  lerTodasPaginas((cursor,n)=>{let q=db.from('linhas_extrato_conta').select('id,conta_id,data').is('movimento_id',null).eq('ignorada',false).gte('data',inicio).lt('data',mes+'-01').order('id').limit(n);if(cursor)q=q.gt('id',cursor);return q.abortSignal(AbortSignal.timeout(15000));}),
  lerTodasPaginas((cursor,n)=>{let q=db.from('vw_movimentos_competencia').select('id,data_compra,valor_total,tipo,natureza').gte('data_compra',inicio).lt('data_compra',mes+'-01').order('id').limit(n);if(cursor)q=q.gt('id',cursor);return q.abortSignal(AbortSignal.timeout(15000));}),
  lerTodasPaginas((cursor,n)=>{let q=db.from('vw_parcelas_planejamento').select('*').gte('competencia',mes+'-01').lt('competencia',fim).order('id').limit(n);if(cursor)q=q.gt('id',cursor);return q.abortSignal(AbortSignal.timeout(15000));}),
  lerTodasPaginas((cursor,n)=>{let q=db.from('vw_previsoes_parcelamento').select('*').gte('competencia',mes+'-01').lt('competencia',fim).order('id').limit(n);if(cursor)q=q.gt('id',cursor);return q.abortSignal(AbortSignal.timeout(15000));}),
  lerTodasPaginas((cursor,n)=>{let q=db.from('recorrencias').select('id,descricao,valor,periodicidade,status,proxima_data,dia_do_mes,cartao_id').eq('finalidade','ASSINATURA').eq('status','ATIVA').order('id').limit(n);if(cursor)q=q.gt('id',cursor);return q.abortSignal(AbortSignal.timeout(15000));}),
  lerTodasPaginas((cursor,n)=>{let q=db.from('vw_cobrancas_assinaturas').select('*').gte('competencia',mes+'-01').lt('competencia',fim).order('id').limit(n);if(cursor)q=q.gt('id',cursor);return q.abortSignal(AbortSignal.timeout(15000));}),
 ]);
 if(preferencias.error)throw new Error('Preferências indisponíveis. Verifique a instalação e tente novamente.');
 const cobertura=meses.map(m=>coberturaMes(m,contas,cartoes,lotes,pendentes));
 const assinaturas=recorrencias.map(r=>{
  if(!r.periodicidade||!['MENSAL','TRIMESTRAL','SEMESTRAL','ANUAL'].includes(r.periodicidade))throw new Error('Periodicidade de assinatura inválida.');
  return {...r,periodicidade:r.periodicidade as AssinaturaPlanejamento['periodicidade'],status:'ATIVA' as const};
 });
 let sugestaoCaixa:{caixa:number;compromissos:number;data:string}|null=null;
 try{const p=await consultarPrevisao(db,hoje);sugestaoCaixa={caixa:p.livre,compromissos:p.fluxo.compromissosMes,data:hoje};}catch{/* Assistência indisponível não remove modo manual nem inventa zeros. */}
 return {
  sugestaoCaixa,
  preferencias:preferencias.data?validarPreferencias(preferencias.data.dados):PREFERENCIAS_INICIAIS,
  atualizadoEm:preferencias.data?.updated_at??null,
  cobertura,
  bases:cobertura.every(m=>m.completo)?basesHistoricas(movimentos,meses):null,
  pisoGasto:montarPlanejamento({mes,cartoes,parcelas,previsoes,assinaturas,cobrancas})[0].total,
 };
}
export type DadosReserva=Omit<Awaited<ReturnType<typeof consultarReserva>>,'sugestaoCaixa'>&{sugestaoCaixa?:{caixa:number;compromissos:number;data:string}|null};
