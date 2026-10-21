import { test,expect,vi,beforeEach } from 'vitest';
import {render,screen,waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ReservaInteligente from '@/components/reserva-inteligente';
import {PREFERENCIAS_INICIAIS} from '@/lib/reserva-inteligente';

const rpc=vi.fn();
vi.mock('@/lib/supabase/client',()=>({createClient:()=>({rpc})}));
const id='00000000-0000-0000-0000-000000000001';
const dados={preferencias:{...PREFERENCIAS_INICIAIS,intencao:150000,margem:50000,caixa:200000,compromissos:30000,receita:600000,gasto:430000},atualizadoEm:null,cobertura:[{mes:'2026-09',completo:false,faltas:['Conferir extrato de Itaú.']}],bases:null,pisoGasto:400000};
function montar(){render(<ReservaInteligente dados={dados} metas={[{id,nome:'Reserva',valor_alvo:1000000,saldo_atual:0,data_alvo:null}]} hoje="2026-10-19"/>);}
beforeEach(()=>{rpc.mockReset();rpc.mockReturnValue({abortSignal:()=>Promise.resolve({error:null})});});
test('simulação exige conferência e não cria aportes',async()=>{
 const u=userEvent.setup();montar();expect(screen.queryByText(/disponíveis para esta proposta/)).toBeNull();
 await u.click(screen.getByRole('checkbox'));
 expect(screen.getByText(/1\.200,00.*disponíveis para esta proposta/)).toBeInTheDocument();
 expect(screen.getByText('Simulação')).toBeInTheDocument();expect(rpc).not.toHaveBeenCalled();
 await u.clear(screen.getByLabelText(/Caixa livre hoje/));
 expect(screen.queryByText(/disponíveis para esta proposta/)).toBeNull();expect(screen.getByText(/Faltam dados: informe/)).toBeInTheDocument();
});
test('salva apenas preferências e relata erro de rede',async()=>{
 const u=userEvent.setup();montar();await u.click(screen.getByRole('button',{name:'Salvar preferências'}));
 await waitFor(()=>expect(screen.getByRole('status')).toHaveTextContent('Nenhum aporte foi realizado'));
 expect(rpc).toHaveBeenCalledExactlyOnceWith('salvar_preferencias_reserva',{p_dados:{...dados.preferencias,prioridades:{[id]:2}}});
 rpc.mockReturnValueOnce({abortSignal:()=>Promise.reject(new Error('Rede indisponível'))});
 await u.click(screen.getByRole('button',{name:'Salvar preferências'}));
 await waitFor(()=>expect(screen.getByRole('alert')).toHaveTextContent('Erro inesperado. Tente de novo.'));
});

test('valores conhecidos preenchem a simulação sem aporte nem receita futura',async()=>{
 const u=userEvent.setup();render(<ReservaInteligente dados={{...dados,sugestaoCaixa:{caixa:-1000,compromissos:40000,data:'2026-10-20'}}} metas={[{id,nome:'Reserva',valor_alvo:1000000,saldo_atual:0,data_alvo:null}]} hoje="2026-10-20"/>);
 await u.click(screen.getByRole('checkbox'));await u.click(screen.getByRole('button',{name:'Carregar valores conhecidos para conferir'}));
 expect(screen.getByLabelText(/Caixa livre hoje/)).toHaveValue('0,00');expect(screen.getByLabelText(/Compromissos ainda/)).toHaveValue('400,00');
 expect(screen.getByRole('checkbox')).not.toBeChecked();expect(rpc).not.toHaveBeenCalled();
 await u.click(screen.getByRole('checkbox'));expect(screen.getByText(/Sem valor nesta proposta/)).toBeInTheDocument();
});
