import {paraCentavosAssinado} from './money.ts';
import type {LinhaImportacao} from './csv.ts';

const API='https://api.pluggy.ai';
type Registro=Record<string,unknown>;
function objeto(entrada:unknown):Registro {if(!entrada||typeof entrada!=='object'||Array.isArray(entrada))throw new Error('Resposta bancária inválida.');return entrada as Registro;}
export function normalizarTransacaoPluggy(entrada:unknown,contaId:string):LinhaImportacao|null {
 const t=objeto(entrada);
 if(t.accountId!==contaId)throw new Error('Transação de outra conta recebida.');
 if(t.status==='PENDING')return null;
 if(t.status!=='POSTED'||t.currencyCode!=='BRL'||!['DEBIT','CREDIT'].includes(String(t.type)))throw new Error('Moeda ou situação da transação não suportada.');
 if(typeof t.amount!=='number'||!Number.isFinite(t.amount))throw new Error('Valor bancário inválido.');
 const valor=paraCentavosAssinado(String(t.amount));
 if(valor===null||!Number.isSafeInteger(valor)||(t.type==='DEBIT'&&valor>0)||(t.type==='CREDIT'&&valor<0))throw new Error('Valor ou sinal bancário incompatível.');
 if(typeof t.date!=='string'||!Number.isFinite(Date.parse(t.date)))throw new Error('Data bancária inválida.');
 const data=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo'}).format(new Date(t.date));
 const descricao=typeof t.description==='string'?t.description.trim():'';
 const identificador=typeof t.providerId==='string'&&t.providerId?t.providerId:t.id;
 if(!descricao||descricao.length>500||typeof identificador!=='string'||!identificador||identificador.length>200)throw new Error('Descrição ou identificador bancário inválido.');
 return {data,descricao,valor,id_externo:identificador};
}
async function requisitar(caminho:string,chave:string,fetcher:typeof fetch) {
 const r=await fetcher(API+caminho,{headers:{'X-API-KEY':chave},signal:AbortSignal.timeout(10_000),cache:'no-store'});
 if(!r.ok)throw new Error(r.status===429?'Limite do provedor atingido. Aguarde para tentar novamente.':'Conexão bancária indisponível. Tente novamente mais tarde.');
 const texto=await r.text();if(texto.length>4*1024*1024)throw new Error('Resposta bancária acima do limite.');
 return objeto(JSON.parse(texto));
}
export async function autenticarPluggy(clientId:string,clientSecret:string,fetcher:typeof fetch=fetch):Promise<string> {
 const r=await fetcher(API+'/auth',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({clientId,clientSecret}),signal:AbortSignal.timeout(10_000),cache:'no-store'});
 if(!r.ok)throw new Error('Não foi possível autenticar a conexão bancária. Confira a configuração privada.');
 const body=objeto(await r.json());if(typeof body.apiKey!=='string')throw new Error('Autorização bancária inválida.');return body.apiKey;
}
export type ContaPluggy={id:string;itemId:string;nome:string;saldo:number;atualizadaEm:string|null};
export async function listarContasPluggy(chave:string,itens:string[],fetcher:typeof fetch=fetch):Promise<ContaPluggy[]> {
 if(itens.length<1||itens.length>5)throw new Error('Configure de uma a cinco conexões pessoais.');
 const contas:ContaPluggy[]=[];
 for(const itemId of itens) {
  const item=await requisitar('/items/'+encodeURIComponent(itemId),chave,fetcher);
  if(item.status!=='UPDATED')throw new Error('Uma conexão bancária precisa de atualização ou autorização no Meu Pluggy.');
  const r=await requisitar('/accounts?itemId='+encodeURIComponent(itemId),chave,fetcher);
  if(!Array.isArray(r.results)||r.results.length>50)throw new Error('Lista de contas inválida.');
  for(const entrada of r.results){const c=objeto(entrada);if(c.type!=='BANK'||c.currencyCode!=='BRL')continue;
   const saldo=c.balance===0?0:paraCentavosAssinado(String(c.balance));
   if(typeof c.id!=='string'||c.itemId!==itemId||saldo===null||!Number.isSafeInteger(saldo))throw new Error('Conta bancária inválida.');
   contas.push({id:c.id,itemId,nome:String(c.name??'Conta bancária').slice(0,100),saldo,atualizadaEm:typeof item.lastUpdatedAt==='string'?item.lastUpdatedAt:null});
  }
 }
 return contas;
}
export async function lerTransacoesPluggy(chave:string,contaId:string,de:string,ate:string,fetcher:typeof fetch=fetch) {
 const linhas:LinhaImportacao[]=[];let after:string|null=null;const cursores=new Set<string>();let pendentes=0;
 // UTC pode atravessar a data civil de São Paulo. A margem é filtrada depois da conversão.
 const inicio=new Date(de+'T12:00:00Z');inicio.setUTCDate(inicio.getUTCDate()-1);
 const fim=new Date(ate+'T12:00:00Z');fim.setUTCDate(fim.getUTCDate()+1);
 for(let pagina=0;pagina<10;pagina++){
  const params=new URLSearchParams({accountId:contaId,dateFrom:inicio.toISOString().slice(0,10),dateTo:fim.toISOString().slice(0,10)});if(after)params.set('after',after);
  const r=await requisitar('/v2/transactions?'+params.toString(),chave,fetcher);
  if(!Array.isArray(r.results)||r.results.length>500)throw new Error('Página de transações inválida.');
  for(const t of r.results){const linha=normalizarTransacaoPluggy(t,contaId);if(linha&&linha.data>=de&&linha.data<=ate)linhas.push(linha);else if(!linha)pendentes++;}
  if(linhas.length>1000)throw new Error('Mais de 1000 transações. Selecione um período menor.');
  if(r.next===null)return {linhas,pendentes};
  if(typeof r.next!=='string'||!r.next.startsWith('?')||r.next.length>4000)throw new Error('Cursor bancário inválido.');
  const proximo=new URLSearchParams(r.next.slice(1));const nova=proximo.get('after');
  if(!nova||cursores.has(nova))throw new Error('A paginação bancária não avançou.');
  cursores.add(nova);after=nova;
 }
 throw new Error('A consulta bancária excedeu o limite de páginas.');
}
