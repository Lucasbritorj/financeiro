import {test,expect,vi} from 'vitest';
import type {SupabaseClient} from '@supabase/supabase-js';
import type {Database} from '@/lib/database.types';
import {consultarPrevisao} from '@/lib/previsao-consulta';

function banco(data:unknown,error:unknown=null){
 const rpc=vi.fn(()=>({abortSignal:()=>Promise.resolve({data,error})}));
 const from=vi.fn(()=>{throw new Error('Leitura fora do snapshot');});
 return {db:{rpc,from} as unknown as SupabaseClient<Database>,rpc,from};
}
test('previsão usa fotografia única, desconta reservas e preserva caixa zero',async()=>{
 const {db,from}=banco({caixa:0,reservado:1000,eventos:[]});
 const p=await consultarPrevisao(db,'2026-12-01');
 expect(p.livre).toBe(-1000);expect(p.fluxo.final).toBe(-1000);expect(p.fim).toBe('2027-02-28');expect(from).not.toHaveBeenCalled();
});
test('resposta parcial, sem precisão ou erro nunca vira projeção completa',async()=>{
 for(const data of [null,[],{caixa:100,reservado:0},{caixa:Number.MAX_SAFE_INTEGER+1,reservado:0,eventos:[]},{caixa:0,reservado:0,eventos:null}]){
  await expect(consultarPrevisao(banco(data).db,'2026-10-20')).rejects.toThrow(/dados da previsão/);
 }
 await expect(consultarPrevisao(banco({caixa:0,reservado:0,eventos:[]},{message:'Rede'}).db,'2026-10-20')).rejects.toThrow(/dados da previsão/);
});
