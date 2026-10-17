import {test,expect} from 'vitest';
import type {SupabaseClient} from '@supabase/supabase-js';
import type {Database} from '@/lib/database.types';
import {consultarAlertas,consultarPlanejamento} from '@/lib/planejamento-consulta';

// Emula filtros/paginação da API para testar a janela real escolhida pelo serviço.
function banco() {
 const massa:Record<string,Record<string,unknown>[]>={
  recorrencias:[{id:'a',finalidade:'ASSINATURA',status:'ATIVA',descricao:'Anuidade fictícia',valor:12000,periodicidade:'ANUAL',proxima_data:'2027-09-01',dia_do_mes:1,cartao_id:'c'}],
  vw_cobrancas_assinaturas:[{id:'1',assinatura_id:'a',cartao_id:'c',competencia:'2025-09-01',data:'2025-09-01',valor:10000},{id:'2',assinatura_id:'a',cartao_id:'c',competencia:'2026-09-01',data:'2026-09-01',valor:12000}],
  cartoes_credito:[{id:'c',nome:'Cartão fictício',dia_fechamento:20}],
  vw_contas_a_pagar:[],vw_parcelas_planejamento:[],vw_previsoes_parcelamento:[],
 };
 return {from:(tabela:string)=>{
  let linhas=[...massa[tabela]];
  const q={select:()=>q,eq:(campo:string,v:unknown)=>{linhas=linhas.filter(l=>l[campo]===v);return q;},
   gte:(campo:string,v:string)=>{linhas=linhas.filter(l=>String(l[campo])>=v);return q;},lt:(campo:string,v:string)=>{linhas=linhas.filter(l=>String(l[campo])<v);return q;},
   lte:(campo:string,v:string)=>{linhas=linhas.filter(l=>String(l[campo])<=v);return q;},gt:(campo:string,v:string)=>{linhas=linhas.filter(l=>String(l[campo])>v);return q;},
   order:(campo:string)=>{linhas.sort((a,b)=>String(a[campo]).localeCompare(String(b[campo])));return q;},limit:(n:number)=>{linhas=linhas.slice(0,n);return q;},
   then:(resolve:(r:unknown)=>unknown)=>Promise.resolve({data:linhas,error:null}).then(resolve),
  };return q;
 }} as unknown as SupabaseClient<Database>;
}
test('CA9: consulta preserva cobrança anterior de assinatura anual',async()=>{
 const alertas=await consultarAlertas(banco(),'2026-10-17');
 expect(alertas.filter(a=>a.tipo==='AUMENTO')).toHaveLength(1);
 expect(alertas.find(a=>a.tipo==='AUMENTO')?.valor).toBe(12000);
});
test('CA9: mudar mês do planejamento não altera a evidência histórica dos alertas',async()=>{
 const atual=await consultarPlanejamento(banco(),'2026-10','2026-10-17');
 const antigo=await consultarPlanejamento(banco(),'2025-09','2026-10-17');
 expect(atual.alertas).toEqual(antigo.alertas);
});
