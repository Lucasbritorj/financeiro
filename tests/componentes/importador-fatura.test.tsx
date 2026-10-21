import { test, expect, vi } from 'vitest';
import { render, screen, fireEvent, renderHook, act } from '@testing-library/react';
import { analisarLinhaFatura } from '@/lib/importacao-fatura';
const {rpc,ler} = vi.hoisted(()=>({rpc:vi.fn(),ler:vi.fn()}));
vi.mock('next/navigation',()=>({useRouter:()=>({refresh:vi.fn()})}));
vi.mock('@/lib/supabase/client',()=>({createClient:()=>({rpc:(...args:unknown[])=>({abortSignal:()=>rpc(...args)}),from:()=>{
  const q={select:()=>q,eq:()=>q,gt:()=>q,order:()=>q,limit:()=>Promise.resolve({data:[],error:null})};return q;
}})}));
vi.mock('@/lib/leitura-arquivo',()=>({lerArquivoFatura:ler,sha256DoArquivo:async()=>null}));
import ImportadorFatura from '@/components/importador-fatura';
import {useImportacaoFatura} from '@/components/use-importacao-fatura';
import ImportadorCsv from '@/components/importador-csv';

test('CA1–CA2: confirmação conjunta inclui somente datas pendentes e edição pede reconferência',async()=>{
 const compra=analisarLinhaFatura({data:'2026-09-01',valor:1000,descricao:'COMPRA FICTICIA'});
 ler.mockResolvedValue({linhas:[{...compra,data_confirmada:false},{...compra,ignorar:true,data_confirmada:false},{...compra,tipo:'INFORMATIVO',data_confirmada:false,ignorar:true}],descartadas:0,total_informado:null});
 const {result}=renderHook(()=>useImportacaoFatura());
 await act(()=>{result.current.setCartaoId('cartao');result.current.setCompetencia('2026-09');});
 await act(()=>result.current.processar(new File(['pdf'],'fatura.pdf')));
 await act(()=>result.current.confirmarDatas());
 expect(result.current.revisao?.linhas.map(l=>l.data_confirmada)).toEqual([true,false,false]);
 await act(()=>result.current.alterar(0,{data:'2025-09-01'}));
 expect(result.current.revisao?.linhas[0].data_confirmada).toBe(false);
});

test('CA1: revisão filtra pendências e só confirma em conjunto após declaração explícita',async()=>{
 const compra=analisarLinhaFatura({data:'2026-09-01',valor:1000,descricao:'COMPRA FICTICIA'});
 ler.mockResolvedValue({linhas:[{...compra,data_confirmada:false},{...compra,descricao:'IGNORADA',ignorar:true,data_confirmada:false}],descartadas:0,total_informado:1000});
 render(<ImportadorFatura cartoes={[{id:'cartao',nome:'Cartão fictício'}]} categorias={[]}/>);
 fireEvent.change(screen.getByLabelText('Cartão da fatura'),{target:{value:'cartao'}});
 fireEvent.change(screen.getByLabelText('Mês da fatura'),{target:{value:'2026-09'}});
 fireEvent.change(screen.getByLabelText(/Arquivo da fatura/),{target:{files:[new File(['pdf'],'fatura.pdf')]}});
 const botao=await screen.findByRole('button',{name:'Confirmar as 1 datas conferidas'});
 expect(botao).toBeDisabled();
 fireEvent.click(screen.getByLabelText('Mostrar somente datas pendentes'));
 expect(screen.queryByLabelText('Descrição da linha 2')).not.toBeInTheDocument();
 fireEvent.click(screen.getByLabelText('Conferi as datas pendentes das compras selecionadas, incluindo o ano.'));
 fireEvent.click(botao);
 expect(await screen.findByText(/Todas as datas selecionadas foram conferidas/)).toBeVisible();
 fireEvent.click(screen.getByLabelText('Mostrar somente datas pendentes'));
 fireEvent.change(screen.getByLabelText('Data da linha 1'),{target:{value:'2025-09-01'}});
 expect(screen.getByRole('button',{name:'Confirmar as 1 datas conferidas'})).toBeDisabled();
});

test('CA1: importação exige escolha explícita antes de mostrar upload',()=>{
 render(<ImportadorCsv categorias={[]}/>);
 expect(screen.getByLabelText('O que você quer importar?')).toHaveValue('');
 expect(screen.queryByLabelText(/arquivo.*extrato/i)).not.toBeInTheDocument();
});

test('CA8: PDF divergente é bloqueado mesmo com conferência marcada',async()=>{
 ler.mockResolvedValue({linhas:[analisarLinhaFatura({data:'2026-09-01',valor:1000,descricao:'COMPRA'})],descartadas:0,total_informado:2000});
 const {result}=renderHook(()=>useImportacaoFatura());
 await act(()=>{result.current.setCartaoId('cartao');result.current.setCompetencia('2026-09');});
 await act(()=>result.current.processar(new File(['pdf'],'fatura.pdf')));
 await act(()=>result.current.setConferido(true));
 const chamadas=rpc.mock.calls.length;
 await act(()=>result.current.confirmar());
 expect(result.current.erro).toMatch(/total|diferença/i);
 expect(rpc.mock.calls.length).toBe(chamadas);
});

test('CA6: data sugerida não confirmada impede gravação',async()=>{
 ler.mockResolvedValue({linhas:[{...analisarLinhaFatura({data:'2025-09-01',valor:1000,descricao:'COMPRA'}),data_confirmada:false}],descartadas:0,total_informado:1000});
 const {result}=renderHook(()=>useImportacaoFatura());
 await act(()=>{result.current.setCartaoId('cartao');result.current.setCompetencia('2026-09');});
 await act(()=>result.current.processar(new File(['pdf'],'fatura.pdf')));
 const chamadas=rpc.mock.calls.length;
 await act(()=>result.current.confirmar());
 expect(result.current.erro).toMatch(/data/i);expect(rpc.mock.calls.length).toBe(chamadas);
});

test('CA8: total extraído do PDF não pode ser apagado nem substituído para liberar diferença',async()=>{
 ler.mockResolvedValue({linhas:[analisarLinhaFatura({data:'2026-09-01',valor:1000,descricao:'COMPRA A'}),analisarLinhaFatura({data:'2026-09-02',valor:1000,descricao:'COMPRA B'})],descartadas:0,total_informado:2000});
 const {result}=renderHook(()=>useImportacaoFatura());
 await act(()=>{result.current.setCartaoId('cartao');result.current.setCompetencia('2026-09');});
 await act(()=>result.current.processar(new File(['pdf'],'fatura.pdf')));
 await act(()=>result.current.alterar(1,{ignorar:true}));
 const chamadas=rpc.mock.calls.length;
 for(const total of [null,1000]){
  await act(()=>result.current.alterarTotal(total));
  await act(()=>result.current.setConferido(true));
  await act(()=>result.current.confirmar());
  expect(result.current.erro).toMatch(/total|diferença/i);
  expect(rpc.mock.calls.length).toBe(chamadas);
 }
});
test('conta vazia orienta cadastrar cartão sem liberar upload',()=>{
 render(<ImportadorFatura cartoes={[]} categorias={[]}/>);
 expect(screen.getByRole('link',{name:/cadastrar cartão/i})).toHaveAttribute('href','/cartoes');
 expect(screen.getByLabelText(/arquivo da fatura/i)).toBeDisabled();
});
test('cartão e mês são obrigatórios antes de ler arquivo',async()=>{
 const {result}=renderHook(()=>useImportacaoFatura());
 await act(()=>result.current.processar(new File(['pdf'],'fatura.pdf')));
 expect(result.current.erro).toMatch(/cartão.*mês/i);expect(ler).not.toHaveBeenCalled();
});
test('falha de confirmação preserva revisão/chave e libera nova tentativa',async()=>{
 ler.mockResolvedValue({linhas:[analisarLinhaFatura({data:'2026-10-01',valor:-10000,descricao:'COMPRA'})],descartadas:0,total_informado:null});
 const {result}=renderHook(()=>useImportacaoFatura());
 await act(()=>{result.current.setCartaoId('cartao');result.current.setCompetencia('2026-10');});
 await act(()=>result.current.processar(new File(['pdf'],'fatura.pdf')));
 rpc.mockRejectedValueOnce(new Error('rede indisponível'));
 await act(()=>result.current.confirmar());
 expect(result.current.erro).toBe('Erro inesperado. Tente de novo.');expect(result.current.pendente).toBe(false);expect(result.current.revisao).not.toBeNull();
 const chave=rpc.mock.calls.at(-1)?.[1].p_chave;
 rpc.mockResolvedValueOnce({data:{criadas:1,duplicadas:0},error:null});
 await act(()=>result.current.confirmar());
 expect(rpc.mock.calls.at(-1)?.[1].p_chave).toBe(chave);expect(result.current.revisao).toBeNull();
});
test('PDF/CSV e revisão permanecem apresentados sem exigir IA externa',()=>{
 render(<ImportadorFatura cartoes={[{id:'cartao',nome:'Itaú'}]} categorias={[]}/>);
 fireEvent.change(screen.getByLabelText('Cartão da fatura'),{target:{value:'cartao'}});
 expect(screen.getByText(/PDF com texto/i)).toBeInTheDocument();
});
