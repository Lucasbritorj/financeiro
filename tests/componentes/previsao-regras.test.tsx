import {test,expect,vi,beforeEach} from 'vitest';
import {render,screen,waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import RegraPessoal from '@/components/regra-pessoal';
import PrevisaoSaldo from '@/components/previsao-saldo';
import {calcularFluxo} from '@/lib/previsao-caixa';

const rpc=vi.fn(),refresh=vi.fn();
vi.mock('next/navigation',()=>({useRouter:()=>({refresh})}));
vi.mock('@/lib/supabase/client',()=>({createClient:()=>({rpc})}));
const previa={versao:'v1',tipo:'DESPESA',total:1,exemplos:[{id:'tx',descricao:'MERCADO TESTE'}],amplo:false,conflito:null};
beforeEach(()=>{rpc.mockReset();refresh.mockReset();rpc.mockReturnValue({abortSignal:()=>Promise.resolve({data:previa,error:null})});});

test('regra exige prévia e confirmação, preserva descrição e invalida prévia ao editar',async()=>{
 const u=userEvent.setup();render(<RegraPessoal transacaoId="tx" categoriaId="cat" descricao={'MERCADO TESTE '+ 'X'.repeat(50)}/>);
 await u.click(screen.getByRole('button',{name:'Criar regra'}));
 expect((screen.getByLabelText('Texto a reconhecer') as HTMLInputElement).value.length).toBe(64);
 expect(rpc).not.toHaveBeenCalled();
 await u.clear(screen.getByLabelText('Texto a reconhecer'));await u.type(screen.getByLabelText('Texto a reconhecer'),'MERCADO');
 await u.click(screen.getByRole('button',{name:'Ver prévia'}));
 await waitFor(()=>expect(screen.getByRole('button',{name:'Salvar regra pessoal'})).toBeDisabled());
 expect(rpc).toHaveBeenLastCalledWith('consultar_previa_regra',expect.objectContaining({p_padrao:'MERCADO'}));
 await u.click(screen.getByRole('checkbox'));await u.click(screen.getByRole('button',{name:'Salvar regra pessoal'}));
 await waitFor(()=>expect(screen.getByRole('status')).toHaveTextContent('Regra salva'));
 expect(rpc).toHaveBeenLastCalledWith('salvar_regra_pessoal',expect.objectContaining({p_versao:'v1',p_chave:expect.any(String)}));
 expect(refresh).toHaveBeenCalledOnce();
 await u.click(screen.getByRole('button',{name:'Criar regra'}));await u.click(screen.getByRole('button',{name:'Ver prévia'}));
 await screen.findByRole('checkbox');await u.type(screen.getByLabelText('Texto a reconhecer'),' ABC');
 expect(screen.queryByRole('button',{name:'Salvar regra pessoal'})).toBeNull();
});

test('conflito bloqueia e falha de rede mantém a mesma chave para repetir',async()=>{
 const u=userEvent.setup();render(<RegraPessoal transacaoId="tx" categoriaId="cat" descricao="MERCADO TESTE"/>);
 rpc.mockReturnValueOnce({abortSignal:()=>Promise.resolve({data:{...previa,conflito:'Outra categoria'},error:null})});
 await u.click(screen.getByRole('button',{name:'Criar regra'}));await u.click(screen.getByRole('button',{name:'Ver prévia'}));
 await screen.findByRole('alert');await u.click(screen.getByRole('checkbox'));expect(screen.getByRole('button',{name:'Salvar regra pessoal'})).toBeDisabled();
 await u.click(screen.getByRole('button',{name:'Ver prévia'}));await screen.findByRole('checkbox');await u.click(screen.getByRole('checkbox'));
 rpc.mockReturnValueOnce({abortSignal:()=>Promise.reject(new Error('Rede indisponível'))});
 await u.click(screen.getByRole('button',{name:'Salvar regra pessoal'}));await screen.findByRole('alert');
 const args=rpc.mock.calls.at(-1)![1];await u.click(screen.getByRole('button',{name:'Salvar regra pessoal'}));
 await screen.findByRole('status');expect(rpc.mock.calls.at(-1)![1]).toEqual(args);
});

test('projeção exige base conferida e mostra déficit antes da receita',async()=>{
 const u=userEvent.setup();const eventos=[{id:'s',data:'2026-10-21',valor:10000,tipo:'SAIDA' as const,descricao:'Conta',situacao:'REGISTRADA' as const,origem:'/faturas'},{id:'e',data:'2026-10-30',valor:30000,tipo:'ENTRADA' as const,descricao:'Salário',situacao:'PREVISTA' as const,origem:'/transacoes'}];
 render(<PrevisaoSaldo dados={{hoje:'2026-10-20',fim:'2027-01-17',caixa:0,reservado:0,livre:0,eventos,fluxo:calcularFluxo(0,eventos,'2026-10-20','2027-01-17')}}/>);
 expect(screen.queryByText(/Pode faltar dinheiro/)).toBeNull();await u.click(screen.getByRole('checkbox'));
 expect(screen.getByText(/Pode faltar dinheiro/)).toBeInTheDocument();expect(screen.getByText(/Menor saldo diário/)).toHaveTextContent('21/10/2026');
 await u.type(screen.getByLabelText(/Saldo-base livre/),'1');expect(screen.queryByText(/Pode faltar dinheiro/)).toBeNull();expect(rpc).not.toHaveBeenCalled();
});
