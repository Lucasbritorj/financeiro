import { createClient } from "@/lib/supabase/server";
import ImportadorCsv from "@/components/importador-csv";
import { lerTodasPaginas } from '@/lib/leitura-paginada';
import HistoricoImportacoes, { type LoteHistorico } from '@/components/historico-importacoes';

export default async function ImportarPage() {
  const supabase = await createClient();
  const [categorias,cartoes]=await Promise.all([
    lerTodasPaginas<{id:string;nome:string;tipo:string}>((id,n)=>{
      let q=supabase.from('categorias').select('id,nome,tipo');if(id)q=q.gt('id',id);return q.order('id').limit(n);
    }),
    lerTodasPaginas<{id:string;nome:string}>((id,n)=>{
      let q=supabase.from('cartoes_credito').select('id,nome');if(id)q=q.gt('id',id);return q.order('id').limit(n);
    }),
  ]);
  let lotes:LoteHistorico[]=[];let erroHistorico=false;
  try {
    lotes=await lerTodasPaginas<LoteHistorico>((cursor,n)=>{
      let q=supabase.from('vw_historico_importacoes').select('*').order('id').limit(n);
      if(cursor)q=q.gt('id',cursor);return q;
    });
  }catch{erroHistorico=true;}

  return (
    <div className="grid gap-6">
      <div className="grid gap-1">
        <h1 className="serifa text-2xl font-medium">Importar arquivos</h1>
        <p className="text-sm" style={{ color: "var(--grafite)" }}>
          Extrato bancário ou fatura de cartão: leia o arquivo, confira os lançamentos e confirme antes de registrar.
        </p>
      </div>
      <ImportadorCsv categorias={categorias} cartoes={cartoes} />
      <HistoricoImportacoes lotes={lotes} erroConsulta={erroHistorico}/>
    </div>
  );
}
