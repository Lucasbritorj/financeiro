"use client";
import {useEffect,useState} from 'react';
import {formatarCentavos} from '@/lib/money';
type ContaDisponivel={id:string;nome:string;saldo:number;atualizadaEm:string|null};

export default function PluggyPessoal({contaId,mes,atualizar}:{contaId:string;mes:string;atualizar:()=>void}) {
 const [configurada,setConfigurada]=useState<boolean|null>(null);const [contas,setContas]=useState<ContaDisponivel[]>([]);const [selecionada,setSelecionada]=useState('');
 const [pendente,setPendente]=useState(false);const [erro,setErro]=useState('');const [aviso,setAviso]=useState('');
 useEffect(()=>{let ativo=true;fetch('/api/pluggy',{signal:AbortSignal.timeout(15_000),cache:'no-store'}).then(async r=>{if(!r.ok)throw new Error();const data=await r.json();if(ativo)setConfigurada(data.configurada===true);}).catch(()=>{if(ativo)setErro('Não foi possível consultar a conexão pessoal.');});return()=>{ativo=false;};},[]);
 async function executar(acao:string) {
  if(pendente)return;setPendente(true);setErro('');setAviso('');
  try{
   const r=await fetch('/api/pluggy',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({acao,contaId,accountId:selecionada,mes}),signal:AbortSignal.timeout(90_000),cache:'no-store'});
   const data=await r.json();if(!r.ok||data.erro)throw new Error(data.erro??'A conexão não respondeu.');
   if(data.configurada===false){setConfigurada(false);return;}
   if(acao==='LISTAR')setContas(data.contas);
   else {setAviso(acao==='VINCULAR'?'Conta vinculada. Agora você pode receber as movimentações.':`${data.mensagem} ${data.pendentes} movimentações agendadas ficaram de fora.`);atualizar();}
  }catch(e){setErro(e instanceof Error?e.message:'Conexão indisponível.');}finally{setPendente(false);}
 }
 return <details className="vidro-soberano grid gap-3 p-5"><summary className="cursor-pointer font-medium">Conexão pessoal com Meu Pluggy</summary><div className="mt-4 grid gap-3">
  <p className="text-sm">Receba movimentações das suas próprias contas para conferir. A sincronização não cria gastos automaticamente. Atualizações do banco podem estar defasadas; use o saldo da mesma data ao fechar.</p>
  {configurada===false&&<p>A integração ainda precisa ser configurada pelo titular. Você pode continuar usando arquivos de extrato.</p>}
  {configurada===true&&<><button className="botao-fantasma justify-self-start" disabled={pendente} onClick={()=>void executar('LISTAR')}>Consultar minhas contas conectadas</button>{contas.length>0&&<><label>Conta no Meu Pluggy<select className="campo-soberano" value={selecionada} onChange={e=>setSelecionada(e.target.value)}><option value="">Selecione a mesma conta cadastrada acima</option>{contas.map(c=><option key={c.id} value={c.id}>{c.nome} · {formatarCentavos(c.saldo)}</option>)}</select></label><button className="botao-fantasma justify-self-start" disabled={pendente||!selecionada} onClick={()=>void executar('VINCULAR')}>Vincular à conta selecionada no aplicativo</button></>}<button className="botao-soberano justify-self-start" disabled={pendente} onClick={()=>void executar('SINCRONIZAR')}>Receber movimentações do mês</button></>}
  {pendente&&<p role="status">Consultando o provedor…</p>}{aviso&&<p role="status">{aviso}</p>}{erro&&<p role="alert">{erro}</p>}
 </div></details>;
}
