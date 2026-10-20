import { createClient } from "@/lib/supabase/server";
import CofrinhoCard from "@/components/cofrinho-card";
import NovoCofrinhoForm from "@/components/novo-cofrinho-form";
import type { MovimentacaoCofrinho } from "@/lib/cofrinhos";
import { hojeSaoPaulo } from "@/lib/data";
import ReservaInteligente from '@/components/reserva-inteligente';
import { consultarReserva } from '@/lib/reserva-consulta';
import { lerTodasPaginas } from '@/lib/leitura-paginada';
import { deslocarMes } from '@/lib/insights';
import { reservadoNoMes } from '@/lib/reserva-inteligente';

const ORDEM_HORIZONTE = ["CURTO", "MEDIO", "LONGO"] as const;
const ROTULO_HORIZONTE: Record<string, string> = {
  CURTO: "Curto prazo",
  MEDIO: "Médio prazo",
  LONGO: "Longo prazo",
};

type CofrinhoRow = {
  id: string;
  nome: string;
  cor: string | null;
  valor_alvo: number;
  saldo_atual: number;
  data_alvo: string | null;
  horizonte: string;
};

export default async function CofrinhosPage() {
  const supabase = await createClient();
  const hoje = hojeSaoPaulo();
  const [cofres, movimentos, reserva] = await Promise.all([
    lerTodasPaginas((cursor,n)=>{
      let q=supabase.from('cofrinhos').select('id,nome,cor,valor_alvo,saldo_atual,data_alvo,horizonte').eq('arquivado',false).order('id').limit(n);
      if(cursor)q=q.gt('id',cursor);return q.abortSignal(AbortSignal.timeout(15000));
    }),
    // Todos os cofrinhos, inclusive arquivados; janela cobre o ritmo de três meses.
    lerTodasPaginas((cursor,n)=>{
      let q=supabase.from('movimentacoes_cofrinho').select('id,cofrinho_id,valor,tipo,data').gte('data',deslocarMes(hoje.slice(0,7),-3)+'-01').lte('data',hoje).order('id').limit(n);
      if(cursor)q=q.gt('id',cursor);return q.abortSignal(AbortSignal.timeout(15000));
    }),
    // Falha no novo painel não oculta cofrinhos nem vira saldo zero.
    consultarReserva(supabase,hoje).catch(()=>null),
  ]);

  const cofrinhos = cofres as CofrinhoRow[];
  const movPorCofrinho = new Map<string, MovimentacaoCofrinho[]>();
  for (const m of movimentos as (MovimentacaoCofrinho & { cofrinho_id: string })[]) {
    const lista = movPorCofrinho.get(m.cofrinho_id) ?? [];
    lista.push({ valor: m.valor, tipo: m.tipo, data: m.data });
    movPorCofrinho.set(m.cofrinho_id, lista);
  }

  return (
    <div className="grid min-w-0 grid-cols-1 gap-6">
      <div className="grid gap-1">
        <h1 className="serifa text-2xl font-medium">Cofrinhos</h1>
        <p className="text-sm" style={{ color: "var(--grafite)" }}>
          Metas por horizonte. O anel mostra o progresso; o status compara seu
          ritmo real de aportes com o necessário para bater a data.
        </p>
      </div>

      {cofrinhos.length === 0 && (
        <p className="text-sm" style={{ color: "var(--grafite)" }}>
          Nenhum cofrinho ainda. Crie o primeiro — uma reserva de emergência é
          um bom começo.
        </p>
      )}

      {reserva ? <ReservaInteligente dados={reserva} reservadoTotalMes={Math.max(0,reservadoNoMes(movimentos,hoje))} metas={cofrinhos.map(c=>({...c,reservadoMes:reservadoNoMes(movPorCofrinho.get(c.id)??[],hoje)}))} hoje={hoje}/> :
        <p role="status">Planejamento de reservas indisponível. Confira a instalação e tente novamente; seus cofrinhos continuam disponíveis.</p>}

      {ORDEM_HORIZONTE.map((h) => {
        const doGrupo = cofrinhos.filter((c) => c.horizonte === h);
        if (doGrupo.length === 0) return null;
        return (
          <section key={h} className="grid min-w-0 grid-cols-1 gap-3">
            <h2 className="text-xs uppercase tracking-widest" style={{ color: "var(--grafite)" }}>
              {ROTULO_HORIZONTE[h]}
            </h2>
            <div className="grid min-w-0 grid-cols-1 gap-3 md:grid-cols-2">
              {doGrupo.map((c) => (
                <CofrinhoCard
                  key={c.id}
                  cofrinho={c}
                  movimentacoes={movPorCofrinho.get(c.id) ?? []}
                  hojeISO={hoje}
                />
              ))}
            </div>
          </section>
        );
      })}

      <NovoCofrinhoForm />
    </div>
  );
}
