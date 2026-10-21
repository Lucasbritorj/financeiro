import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { hojeSaoPaulo } from '@/lib/data';
import { validarMesOrcamento } from '@/lib/orcamentos-mensais';
import OrcamentosMensais, { type CategoriaOrcamento } from '@/components/orcamentos-mensais';

export default async function OrcamentosPage({searchParams}:{searchParams:Promise<{mes?:string}>}) {
 const {mes:entrada}=await searchParams;const valido=entrada===undefined||validarMesOrcamento(entrada);
 const mes=valido&&entrada?entrada:hojeSaoPaulo().slice(0,7);
 let itens:CategoriaOrcamento[]|null=null;
 try{const {data,error}=await (await createClient()).rpc('consultar_orcamentos_mensais',{p_mes:mes+'-01'});if(error)throw error;itens=data as CategoriaOrcamento[];}catch{/* Nunca substituir consulta incompleta por gasto zero. */}
 return <div className="grid min-w-0 gap-6"><header className="grid gap-3"><h1 className="serifa text-2xl">Orçamentos mensais</h1><p className="text-sm">Defina quanto pretende gastar em cada categoria. Cada mês guarda seu próprio limite.</p><form className="flex flex-wrap items-end gap-3"><label>Mês<input className="campo-soberano" type="month" name="mes" min="2000-01" max="2099-12" defaultValue={mes} required/></label><button className="botao-fantasma">Consultar mês</button></form></header>
 {!valido&&<p role="alert">Mês inválido. Exibindo o mês atual.</p>}
 <p className="border-l-2 pl-4 text-sm" style={{borderColor:'var(--ouro)'}}>Compras no cartão entram no mês da fatura. O pagamento da fatura fica fora deste consumo. Vazio retira o limite deste mês; zero significa que você não pretende gastar.</p>
 {itens===null?<p role="alert">Não foi possível carregar os orçamentos. Confira a conexão e a instalação desta versão.</p>:itens.length?<OrcamentosMensais itens={itens} mes={mes}/>:<p>Cadastre categorias de despesa em <Link className="underline" href="/categorias">Categorias</Link> para começar.</p>}
 </div>;
}
