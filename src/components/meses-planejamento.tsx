import { formatarCentavos } from '@/lib/money';
import { nomeMes } from '@/lib/insights';
import type { MesPlanejamento } from '@/lib/planejamento';

function Valor({rotulo,valor}:{rotulo:string;valor:number}) {
 return <div className="min-w-0"><dt className="text-xs" style={{color:'var(--grafite)'}}>{rotulo}</dt><dd className="numero-soberano mt-1 break-words text-sm">{formatarCentavos(valor)}</dd></div>;
}
export default function MesesPlanejamento({meses}:{meses:MesPlanejamento[]}) {
 return <section className="grid min-w-0 gap-3" aria-label="Compromissos dos próximos 12 meses">
  <h2 className="serifa text-xl">Mês a mês</h2>
  {meses.map((m,i)=><details key={m.mes} open={i===0} className="vidro-soberano min-w-0 p-5">
   <summary className="cursor-pointer rounded-md focus-visible:outline-2 focus-visible:outline-offset-4" aria-label={`${nomeMes(m.mes)} de ${m.mes.slice(0,4)} · ${formatarCentavos(m.total)}`}>
    <span className="ml-1 serifa text-lg capitalize">{nomeMes(m.mes)} {m.mes.slice(0,4)}</span>
    <span className="numero-soberano ml-3 inline-block max-w-full break-words text-lg" style={{color:'var(--ouro)'}}>{formatarCentavos(m.total)}</span>
   </summary>
   <div className="mt-5 grid min-w-0 gap-5">
    {m.cartoes.length===0&&<p className="text-sm">Nenhum cartão cadastrado. Assinaturas sem cartão aparecem abaixo.</p>}
    {m.cartoes.map(c=><section key={c.id} className="grid min-w-0 gap-3 border-t pt-4" style={{borderColor:'var(--borda)'}} aria-label={`${c.nome} em ${m.mes}`}>
     <header className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 gap-y-1"><h3 className="min-w-0 break-words font-medium">{c.nome}</h3><p className="numero-soberano break-words text-sm">Comprometido: {formatarCentavos(c.comprometido)}</p></header>
     <dl className="grid min-w-0 gap-3 sm:grid-cols-3"><Valor rotulo="Registrado na fatura" valor={c.registrado}/><Valor rotulo="Parcelas previstas" valor={c.parcelasPrevistas}/><Valor rotulo="Assinaturas previstas" valor={c.assinaturasPrevistas}/></dl>
    </section>)}
    <dl className="border-t pt-3" style={{borderColor:'var(--borda)'}}><Valor rotulo="Assinaturas previstas sem cartão" valor={m.semCartao}/></dl>
   </div>
  </details>)}
 </section>;
}
