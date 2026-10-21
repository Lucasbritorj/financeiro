"use client";
import {useEffect,useState} from 'react';
import {useRouter} from 'next/navigation';
import {createClient} from '@/lib/supabase/client';
import {hojeSaoPaulo} from '@/lib/data';
import {formatarCentavos,paraCentavos} from '@/lib/money';
import {lerCentavosComZero} from '@/lib/orcamentos-mensais';
import {mensagemDeErro} from '@/lib/erros';
import {lerArquivoImportacao} from '@/lib/leitura-arquivo';
import {origemPorExtensao,extensaoDoArquivo} from '@/lib/importacao-preview';
import {validarTamanhoArquivoImportacao,validarTetoLinhasImportacao} from '@/lib/csv';
import type {ContaBancaria,DetalheConta} from '@/lib/conciliacao-bancaria';
import type {Json} from '@/lib/database.types';
import RevisaoConciliacao from './revisao-conciliacao';
import PluggyPessoal from './pluggy-pessoal';

export default function ContasBancarias({contas}:{contas:ContaBancaria[]}) {
 const router=useRouter();const hoje=hojeSaoPaulo();
 const [conta,setConta]=useState(contas[0]?.id??'');const [mes,setMes]=useState(hoje.slice(0,7));const [rodada,setRodada]=useState(0);
 const [consulta,setConsulta]=useState<{chave:string;data:DetalheConta}|null>(null);const [erro,setErro]=useState('');const [aviso,setAviso]=useState('');const [pendente,setPendente]=useState(false);
 const chaveConsulta=conta+'_'+mes+'_'+rodada;const detalhe=consulta?.chave===chaveConsulta?consulta.data:null;
 const [saldo,setSaldo]=useState('');const [motivo,setMotivo]=useState('');
 const [ocr,setOcr]=useState(false);const [progresso,setProgresso]=useState('');
 const [chave,setChave]=useState<string|null>(null);
 const ate=/^20\d{2}-(0[1-9]|1[0-2])$/.test(mes)?new Date(Number(mes.slice(0,4)),Number(mes.slice(5,7)),0,12).toISOString().slice(0,10):'';
 function atualizar(){setErro('');setRodada(r=>r+1);router.refresh();}
 useEffect(()=>{
  let ativo=true;if(!conta||!ate)return;
  createClient().rpc('consultar_conta_bancaria',{p_conta_id:conta,p_de:mes+'-01',p_ate:ate}).then(({data,error})=>{if(!ativo)return;if(error)setErro(mensagemDeErro(error));else setConsulta({chave:chaveConsulta,data:data as unknown as DetalheConta});},()=>{if(ativo)setErro('Não foi possível carregar a conferência. Tente novamente.');});
  return ()=>{ativo=false;};
 },[conta,mes,ate,chaveConsulta]);
 async function acao(executar:()=>PromiseLike<{error:unknown;data?:unknown}>,sucesso:string) {
  if(pendente)return;setPendente(true);setErro('');setAviso('');
  try{const r=await executar();if(r.error)throw r.error;setAviso(sucesso);atualizar();return r.data;}
  catch(e){setErro(mensagemDeErro(e));}finally{setPendente(false);}
 }
 async function criar(event:React.FormEvent<HTMLFormElement>) {
  event.preventDefault();const f=new FormData(event.currentTarget);const v=lerCentavosComZero(String(f.get('saldo')));
  if(v===null||!Number.isSafeInteger(v)){setErro('Informe um saldo inicial válido.');return;}
  const r=await acao(()=>createClient().rpc('criar_conta_bancaria',{p_nome:String(f.get('nome')),p_saldo_inicial:v,p_data_inicial:String(f.get('data'))}),'Conta cadastrada.');
  if(r)setConta((r as {id:string}).id);
 }
 async function transferir(event:React.FormEvent<HTMLFormElement>) {
  event.preventDefault();const f=new FormData(event.currentTarget);const valor=paraCentavos(String(f.get('valor')));
  if(!Number.isSafeInteger(valor)||valor<=0){setErro('Informe um valor de transferência válido.');return;}
  const id=chave??crypto.randomUUID();setChave(id);
  const r=await acao(()=>createClient().rpc('transferir_entre_contas',{p_origem:String(f.get('origem')),p_destino:String(f.get('destino')),p_valor:valor,p_data:String(f.get('data')),p_chave:id}),'Transferência registrada nas duas contas; confira os extratos.');
  if(r)setChave(null);
 }
 async function importar(arquivo:File) {
  await acao(async()=>{
   const tamanho=validarTamanhoArquivoImportacao(arquivo.size);if(tamanho)throw new Error(tamanho);
   const origem=origemPorExtensao(extensaoDoArquivo(arquivo.name));if(!origem)throw new Error('Formato não reconhecido.');
   const parsed=await lerArquivoImportacao(arquivo,origem,'itau',{ocr,progresso:setProgresso});const limite=validarTetoLinhasImportacao(parsed.linhas.length);if(limite)throw new Error(limite);
   if(!parsed.linhas.length)throw new Error('Nenhuma linha reconhecida. Confira o formato.');
   const r=await createClient().rpc('importar_extrato_conta',{p_conta_id:conta,p_origem:origem,p_linhas:parsed.linhas as unknown as Json});
   if(!r.error)setAviso(`${parsed.linhas.length} linhas lidas; ${parsed.descartadas} descartadas pelo leitor. Confira o período e as repetições.`);
   return r;
  },'Extrato recebido para conferência. Nenhum gasto foi criado automaticamente.');
 }
 async function fechar(){const v=lerCentavosComZero(saldo);if(v===null||!Number.isSafeInteger(v)){setErro('Informe o saldo final do banco.');return;}await acao(()=>createClient().rpc('fechar_conciliacao_conta',{p_conta_id:conta,p_ate:ate,p_saldo_informado:v}),'Período fechado com saldo conferido.');}
 const informado=saldo.trim()===''?null:lerCentavosComZero(saldo);
 return <div className="grid min-w-0 gap-6"><header className="grid gap-2"><h1 className="serifa text-2xl">Contas bancárias</h1><p className="text-sm">Confira os saldos com seus extratos, sem duplicar os gastos já registrados.</p></header>
  <details className="vidro-soberano p-5" open={!contas.length}><summary className="cursor-pointer font-medium">Cadastrar conta bancária</summary><form onSubmit={criar} className="mt-4 grid gap-3 sm:grid-cols-2"><label>Nome da conta<input className="campo-soberano" name="nome" required maxLength={100}/></label><label>Saldo inicial em reais<input className="campo-soberano" name="saldo" inputMode="decimal" required defaultValue="0,00"/></label><label>Data de início<input className="campo-soberano" name="data" type="date" min="2000-01-01" max="2099-12-31" required defaultValue={hoje}/></label><p className="self-center text-sm">Informe o saldo antes das movimentações dessa data. Saldos negativos são aceitos.</p><button className="botao-soberano justify-self-start" disabled={pendente}>Cadastrar conta</button></form></details>
  {contas.length>0&&<><div className="flex flex-wrap gap-3"><label className="min-w-0 flex-1">Conta<select aria-label="Conta" className="campo-soberano" value={conta} onChange={e=>{setConta(e.target.value);setSaldo('');}}>{contas.map(c=><option key={c.id} value={c.id}>{c.nome}</option>)}</select></label><label>Mês da conferência<input className="campo-soberano" type="month" min="2000-01" max="2099-12" value={mes} onChange={e=>setMes(e.target.value)}/></label><button className="botao-fantasma self-end" onClick={atualizar}>Atualizar conferência</button></div>
  {contas.length>1&&<details className="vidro-soberano p-5"><summary className="cursor-pointer">Transferir entre minhas contas</summary><form onSubmit={transferir} className="mt-4 grid gap-3 sm:grid-cols-2"><label>Conta de origem<select className="campo-soberano" name="origem">{contas.map(c=><option key={c.id} value={c.id}>{c.nome}</option>)}</select></label><label>Conta de destino<select className="campo-soberano" name="destino" defaultValue={contas[1].id}>{contas.map(c=><option key={c.id} value={c.id}>{c.nome}</option>)}</select></label><label>Valor da transferência<input className="campo-soberano" name="valor" inputMode="decimal" required/></label><label>Data da transferência<input className="campo-soberano" name="data" type="date" required defaultValue={hoje}/></label><p className="text-sm sm:col-span-2">Transfere saldo entre contas sem criar receita ou despesa. Se a tentativa falhar por dados inválidos, corrija e inicie uma nova tentativa.</p><button className="botao-fantasma justify-self-start" disabled={pendente}>Registrar transferência</button><button className="botao-fantasma" type="button" onClick={()=>setChave(null)}>Nova tentativa de transferência</button></form></details>}
  <section className="vidro-soberano grid gap-4 p-5"><h2 className="serifa text-xl">Receber extrato</h2><label>Arquivo para a conta selecionada<input className="campo-soberano" type="file" accept=".csv,.ofx,.ofc,.xlsx,.pdf" disabled={pendente} onChange={e=>{const f=e.target.files?.[0];if(f)void importar(f);e.target.value='';}}/></label><label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={ocr} onChange={e=>setOcr(e.target.checked)} disabled={pendente}/>Ler PDF digitalizado com OCR</label><p className="text-sm">Prefira OFX ou CSV. Linhas recebidas ficam separadas dos lançamentos até você conferir. Arquivos diferentes sem identificador podem trazer repetições que exigem revisão.</p>{pendente&&progresso&&<p role="status">{progresso}</p>}</section>
  <PluggyPessoal contaId={conta} mes={mes} atualizar={atualizar}/>
  {detalhe&&<><section className="vidro-soberano grid min-w-0 gap-4 p-5"><h2 className="serifa text-xl">Saldo conciliado até {ate.split('-').reverse().join('/')}</h2><p className="numero-soberano text-3xl">{formatarCentavos(detalhe.saldo)}</p><p className="text-sm">{detalhe.linhas.filter(l=>!l.movimento_id&&!l.ignorada).length} linhas do período para conferir. Este saldo inclui apenas o saldo inicial e os movimentos atribuídos à conta.</p><label>Saldo final no banco em reais<input className="campo-soberano" value={saldo} onChange={e=>setSaldo(e.target.value)} inputMode="decimal"/></label>{informado!==null&&Number.isSafeInteger(informado)&&<p role="status">Diferença: {formatarCentavos(detalhe.saldo-informado)}</p>}<button className="botao-fantasma justify-self-start" disabled={pendente||informado===null||!Number.isSafeInteger(informado)} onClick={()=>void fechar()}>Conferir e fechar até esta data</button>{detalhe.conta.fechado_ate&&<div className="grid gap-3"><p>Fechado até {detalhe.conta.fechado_ate}.</p><label>Motivo para reabrir<input className="campo-soberano" minLength={5} maxLength={500} value={motivo} onChange={e=>setMotivo(e.target.value)}/></label><button className="botao-fantasma justify-self-start" disabled={pendente||motivo.trim().length<5} onClick={()=>void acao(()=>createClient().rpc('reabrir_conciliacao_conta',{p_conta_id:conta,p_motivo:motivo}),'Período reaberto; motivo registrado no histórico.')}>Reabrir conferência</button></div>}</section>
  <RevisaoConciliacao detalhe={detalhe} atualizar={atualizar}/><details className="vidro-soberano p-5"><summary>Histórico das últimas 50 ações</summary><ul className="mt-3 grid gap-2 text-sm">{detalhe.historico.map((h,i)=><li key={i}>{new Date(h.created_at).toLocaleString('pt-BR')} · {h.evento.replaceAll('_',' ')}</li>)}</ul></details></>}
  </>}
  {pendente&&<p role="status">Processando…</p>}{aviso&&<p role="status">{aviso}</p>}{erro&&<p role="alert">{erro}</p>}
 </div>;
}
