"use client";
import Link from 'next/link';
import { useImportacaoFatura } from './use-importacao-fatura';
import { RevisaoFatura } from './revisao-fatura';
import type { CategoriaOpcao } from './importador-csv/tabela-revisao';
import PrevisoesParcelamento from './previsoes-parcelamento';

export default function ImportadorFatura({cartoes,categorias}:{cartoes:{id:string;nome:string}[];categorias:CategoriaOpcao[]}) {
 const f=useImportacaoFatura();
 if(f.revisao)return <RevisaoFatura fluxo={f} categorias={categorias} cartaoNome={cartoes.find(c=>c.id===f.revisao?.cartaoId)?.nome??'Cartão'}/>;
 return <div className="grid min-w-0 gap-5"><section className="vidro-soberano grid gap-4 p-5" aria-label="Importar fatura de cartão">
  <div><h2 className="serifa text-xl">Sua fatura, antes de entrar nas contas</h2>
   <p className="mt-2 text-sm">Escolha o cartão e o mês. Você revisará compras, parcelas e possíveis assinaturas antes de confirmar.</p></div>
  {cartoes.length===0&&<p className="text-sm">Primeiro, <Link href="/cartoes" className="underline">cadastrar cartão</Link>. Depois volte para importar a fatura.</p>}
  <div className="grid gap-3 sm:grid-cols-2">
   <label className="text-sm">Cartão da fatura<select className="campo-soberano" value={f.cartaoId} onChange={e=>f.setCartaoId(e.target.value)} disabled={f.pendente}>
    <option value="">Selecione o cartão</option>{cartoes.map(c=><option key={c.id} value={c.id}>{c.nome}</option>)}</select></label>
   <label className="text-sm">Mês da fatura<input className="campo-soberano" type="month" required value={f.competencia} onChange={e=>f.setCompetencia(e.target.value)} disabled={f.pendente}/></label>
  </div>
  <label className="text-sm">Arquivo da fatura (PDF, CSV, OFX/OFC ou XLSX)<input type="file" className="campo-soberano" accept=".pdf,.csv,.ofx,.ofc,.xlsx" disabled={f.pendente||!f.cartaoId||!f.competencia} onChange={e=>{const a=e.target.files?.[0];if(a)void f.processar(a);e.target.value='';}}/></label>
  <p className="text-xs" style={{color:'var(--grafite)'}}>PDF com texto: prioridade para fatura Itaú. Outros layouts podem exigir correção na revisão. PDF digitalizado ou protegido por senha não é suportado. Até 10 MB e 1000 linhas. O arquivo é lido no navegador; nenhum serviço de IA recebe sua fatura.</p>
  {f.pendente&&<p role="status">Lendo arquivo e conferindo registros…</p>}
  {f.erro&&<p role="alert" style={{color:'var(--telha)'}}>{f.erro}</p>}
  {f.aviso&&<p role="status">{f.aviso}</p>}
 </section><PrevisoesParcelamento key={f.cartaoId+f.aviso} cartaoId={f.cartaoId}/></div>;
}
