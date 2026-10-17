import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { hojeSaoPaulo } from '@/lib/data';
import { consultarAlertas } from '@/lib/planejamento-consulta';
import AlertasFinanceiros from '@/components/alertas-financeiros';

export default async function ResumoAlertas() {
 let alertas:Awaited<ReturnType<typeof consultarAlertas>>|null=null;
 try {
  alertas=await consultarAlertas(await createClient(),hojeSaoPaulo());
 }catch {/* Não apresentar ausência de alertas quando a consulta falhar. */}
 if(alertas)return <AlertasFinanceiros alertas={alertas} resumido/>;
 return <section className="vidro-soberano grid gap-2 p-5"><h2 className="serifa text-xl">Pontos de atenção</h2>
   <p role="alert" className="text-sm">Não foi possível consultar os alertas. Confira a instalação e tente novamente em Planejamento.</p>
   <Link className="text-sm underline" href="/planejamento">Abrir Planejamento</Link></section>;
}
