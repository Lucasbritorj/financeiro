import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { hojeSaoPaulo } from '@/lib/data';
import { consultarPlanejamento } from '@/lib/planejamento-consulta';
import AlertasFinanceiros from '@/components/alertas-financeiros';
import MesesPlanejamento from '@/components/meses-planejamento';
import {consultarPrevisao} from '@/lib/previsao-consulta';
import PrevisaoSaldo from '@/components/previsao-saldo';

export default async function PlanejamentoPage({searchParams}:{searchParams:Promise<{mes?:string}>}) {
 const {mes:entrada}=await searchParams;const hoje=hojeSaoPaulo();
 const valido=entrada===undefined||/^20\d{2}-(0[1-9]|1[0-2])$/.test(entrada);
 const mes=valido&&entrada?entrada:hoje.slice(0,7);
 const db=await createClient();
 const [compromissos,fluxo]=await Promise.allSettled([consultarPlanejamento(db,mes,hoje),consultarPrevisao(db,hoje)]);
 // Cada painel exige seu conjunto completo; falha nunca vira total zero.
 const consulta=compromissos.status==='fulfilled'?compromissos.value:null;
 const previsao=fluxo.status==='fulfilled'?fluxo.value:null;
 return <div className="grid min-w-0 gap-6">
  <header className="flex min-w-0 flex-wrap items-end justify-between gap-4"><div className="grid gap-2"><h1 className="serifa text-2xl font-medium">Planejamento</h1><p className="text-sm" style={{color:'var(--grafite)'}}>Seus próximos 12 meses, por cartão.</p></div>
   <form className="flex min-w-0 flex-wrap items-end gap-3" method="get"><label className="text-sm">Mês inicial<input className="campo-soberano" type="month" name="mes" min="2000-01" max="2099-12" defaultValue={mes} required/></label><button className="botao-fantasma" type="submit">Ver próximos meses</button></form>
  </header>
  {!valido&&<p role="alert">Mês inválido. Exibindo o mês atual; escolha um mês entre 2000 e 2099.</p>}
  {previsao?<PrevisaoSaldo dados={previsao}/>:<section className="vidro-soberano p-5"><p role="alert">Previsão de saldo indisponível: faltam dados completos ou a instalação desta versão. Os valores abaixo são compromissos por competência.</p></section>}
  <div className="border-l-2 pl-4 text-sm" style={{borderColor:'var(--ouro)'}}><p>Comprometido = registrado + parcelas previstas + assinaturas previstas. Valores previstos podem mudar e ficam fora dos gastos efetivos.</p>
   <p className="mt-2" style={{color:'var(--grafite)'}}>Registrado inclui cobranças abertas ou já pagas no mês da fatura. Assinaturas seguem a agenda e o fechamento atual do cartão; cobranças vinculadas já registradas substituem a previsão. Compras novas e compromissos não cadastrados não estão incluídos.</p></div>
  {consulta?<><MesesPlanejamento meses={consulta.meses}/><AlertasFinanceiros alertas={consulta.alertas}/></>:<section className="vidro-soberano grid gap-3 p-5"><h2 className="serifa text-lg">Planejamento indisponível</h2><p role="alert">Não foi possível carregar todos os compromissos. Confira a conexão e a instalação desta versão; nenhum total parcial está sendo exibido.</p><Link className="underline" href={`/planejamento?mes=${mes}`}>Tentar novamente</Link></section>}
 </div>;
}
