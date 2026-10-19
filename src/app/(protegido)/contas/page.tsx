import {createClient} from '@/lib/supabase/server';
import {lerTodasPaginas} from '@/lib/leitura-paginada';
import ContasBancarias from '@/components/contas-bancarias';
import type {ContaBancaria} from '@/lib/conciliacao-bancaria';

export default async function ContasPage() {
 let contas:ContaBancaria[]|null=null;
 try{
  const db=await createClient();
  contas=await lerTodasPaginas((cursor,n)=>{let q=db.from('contas_bancarias').select('*').order('id').limit(n);if(cursor)q=q.gt('id',cursor);return q;});
 }catch{/* Falha explícita, sem representar consulta incompleta como conta vazia. */}
 return contas?<ContasBancarias contas={contas}/>:<div className="grid gap-4"><h1 className="serifa text-2xl">Contas bancárias</h1><p role="alert">Não foi possível carregar as contas. Confira a conexão e a instalação desta versão antes de tentar novamente.</p></div>;
}
