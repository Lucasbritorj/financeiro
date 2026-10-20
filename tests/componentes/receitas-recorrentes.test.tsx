import {test,expect,vi,beforeEach} from 'vitest';
import {render,screen,waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import FeedbackProvider from '@/components/feedback';
const rpc=vi.fn();const refresh=vi.fn();
vi.mock('@/lib/supabase/client',()=>({createClient:()=>({rpc})}));
vi.mock('next/navigation',()=>({useRouter:()=>({refresh})}));
const {default:ReceitasRecorrentes}=await import('@/components/receitas-recorrentes');
const linhas=[{id:'a',recorrencia_id:'r1',descricao:'Salário',valor:10000,data_prevista:'2026-10-15',status:'PREVISTA',transacao_id:null},{id:'b',recorrencia_id:'r2',descricao:'Salário',valor:20000,data_prevista:'2026-10-30',status:'PREVISTA',transacao_id:null}];
beforeEach(()=>{rpc.mockReset();refresh.mockReset();rpc.mockImplementation((nome:string)=>({abortSignal:()=>Promise.resolve({data:nome==='consultar_receitas_previstas'?linhas:{},error:null})}));});
function montar(){render(<FeedbackProvider><ReceitasRecorrentes categorias={[]}/></FeedbackProvider>);}
test('previsões não confirmam automaticamente; pular envia somente a ocorrência escolhida',async()=>{
 const user=userEvent.setup();montar();await screen.findByLabelText('Selecionar Salário em 15/10/2026');
 expect(rpc.mock.calls.every(c=>c[0]==='consultar_receitas_previstas')).toBe(true);
 await user.click(screen.getAllByRole('button',{name:'Não recebi nesta data'})[0]);
 await waitFor(()=>expect(rpc).toHaveBeenCalledWith('marcar_receita_nao_recebida',{p_id:'a',p_pular:true,p_motivo:null}));
});
test('receber juntas exige seleção e envia total em centavos com uma chave de tentativa',async()=>{
 const user=userEvent.setup();montar();await user.click(await screen.findByLabelText('Selecionar Salário em 15/10/2026'));await user.click(screen.getByLabelText('Selecionar Salário em 30/10/2026'));
 await user.click(screen.getByRole('button',{name:'Recebi juntas/antecipado'}));
 expect(screen.getByLabelText('Total recebido (R$)')).toHaveValue('300,00');
 await user.click(screen.getByRole('button',{name:'Confirmar recebimento'}));
 await waitFor(()=>expect(rpc).toHaveBeenCalledWith('confirmar_receitas_previstas',expect.objectContaining({p_ids:['a','b'],p_valor:30000,p_chave:expect.any(String)})));
});
test('falha de rede libera confirmação sem perder dados e reaproveita chave',async()=>{
 const user=userEvent.setup();montar();await user.click(await screen.findByLabelText('Selecionar Salário em 15/10/2026'));await user.click(screen.getByRole('button',{name:'Recebi juntas/antecipado'}));
 rpc.mockImplementation((nome:string)=>({abortSignal:()=>nome==='confirmar_receitas_previstas'?Promise.reject(new Error('Falha de rede')):Promise.resolve({data:linhas,error:null})}));
 await user.click(screen.getByRole('button',{name:'Confirmar recebimento'}));await screen.findByRole('alert');
 expect(screen.getByLabelText('Total recebido (R$)')).toHaveValue('100,00');
 await user.click(screen.getByRole('button',{name:'Atualizar revisão'}));
 await waitFor(()=>expect(screen.getByText(/Confirmar 1 ocorrência/)).toBeVisible());
 await user.click(screen.getByRole('button',{name:'Confirmar recebimento'}));
 const chamadas=rpc.mock.calls.filter(c=>c[0]==='confirmar_receitas_previstas');expect(chamadas).toHaveLength(2);expect(chamadas[0][1].p_chave).toBe(chamadas[1][1].p_chave);
});
