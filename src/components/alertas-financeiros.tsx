import Link from 'next/link';
import { formatarCentavos, formatarData } from '@/lib/money';
import type { AlertaFinanceiro } from '@/lib/planejamento';

export default function AlertasFinanceiros({alertas,resumido=false}:{alertas:AlertaFinanceiro[];resumido?:boolean}) {
 const exibidos=resumido?alertas.slice(0,3):alertas;
 return <section className="vidro-soberano grid min-w-0 gap-4 p-5" aria-label="Alertas financeiros">
  <header className="flex flex-wrap items-baseline justify-between gap-3"><h2 className="serifa text-xl">Pontos de atenção</h2>
   {resumido&&<Link href="/planejamento" className="text-sm underline underline-offset-4">Próximos meses e todos os alertas</Link>}</header>
  <p className="text-sm" style={{color:'var(--grafite)'}}>Vencimentos em até 7 dias e sinais nas assinaturas. Confira os registros antes de tomar uma decisão.</p>
  {exibidos.length===0?<p className="text-sm">Nenhum aviso nos registros consultados. Isso não confirma que todas as contas foram cadastradas ou pagas.</p>:<ul className="grid min-w-0 gap-4">
   {exibidos.map(a=><li key={a.id} className="grid min-w-0 gap-1 border-l-2 pl-3" style={{borderColor:a.atrasado?'var(--telha)':'var(--ouro)'}}>
    <Link href={a.href} className="min-w-0 break-words font-medium underline decoration-transparent underline-offset-4 hover:decoration-current">{a.titulo}</Link>
    <p className="min-w-0 break-words text-sm"><span className="numero-soberano">{formatarCentavos(a.valor)}</span>{a.data?` · ${formatarData(a.data)}`:''}</p>
    <p className="break-words text-sm" style={{color:'var(--grafite)'}}>{a.detalhe}</p>
   </li>)}
  </ul>}
  {resumido&&alertas.length>exibidos.length&&<p className="text-xs">Mais {alertas.length-exibidos.length} aviso(s) em Planejamento.</p>}
 </section>;
}
