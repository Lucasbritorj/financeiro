import type {SupabaseClient} from '@supabase/supabase-js';
import type {Database} from './database.types';
import {calcularFluxo,type EventoCaixa} from './previsao-caixa';
export async function consultarPrevisao(db:SupabaseClient<Database>,hoje:string){
 const dataFim=new Date(hoje+'T12:00:00Z');dataFim.setUTCDate(dataFim.getUTCDate()+89);const fim=dataFim.toISOString().slice(0,10);
 const {data,error}=await db.rpc('consultar_eventos_caixa',{p_hoje:hoje}).abortSignal(AbortSignal.timeout(15000));
 const snapshot=data as unknown as {eventos:EventoCaixa[];caixa:number;reservado:number}|null;
 if(error||!snapshot||!Array.isArray(snapshot.eventos)||!Number.isSafeInteger(snapshot.caixa)||!Number.isSafeInteger(snapshot.reservado))throw new Error('Não foi possível carregar todos os dados da previsão.');
 const {caixa,reservado,eventos:itens}=snapshot,livre=caixa-reservado;
 return {hoje,fim,caixa,reservado,livre,eventos:itens,fluxo:calcularFluxo(livre,itens,hoje,fim)};
}
export type DadosPrevisao=Awaited<ReturnType<typeof consultarPrevisao>>;
