import { createClient } from "@/lib/supabase/server";
import CofrinhoCard from "@/components/cofrinho-card";
import NovoCofrinhoForm from "@/components/novo-cofrinho-form";
import type { MovimentacaoCofrinho } from "@/lib/cofrinhos";

const ORDEM_HORIZONTE = ["CURTO", "MEDIO", "LONGO"] as const;
const ROTULO_HORIZONTE: Record<string, string> = {
  CURTO: "Curto prazo",
  MEDIO: "Médio prazo",
  LONGO: "Longo prazo",
};

function hojeSaoPaulo(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
}

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

  const [cofrinhosRes, movRes] = await Promise.all([
    supabase
      .from("cofrinhos")
      .select("id, nome, cor, valor_alvo, saldo_atual, data_alvo, horizonte")
      .eq("arquivado", false)
      .order("created_at", { ascending: true }),
    supabase
      .from("movimentacoes_cofrinho")
      .select("cofrinho_id, valor, tipo, data")
      .order("data", { ascending: false }),
  ]);
  if (cofrinhosRes.error) throw new Error(cofrinhosRes.error.message);
  if (movRes.error) throw new Error(movRes.error.message);

  const cofrinhos = cofrinhosRes.data as CofrinhoRow[];
  const movPorCofrinho = new Map<string, MovimentacaoCofrinho[]>();
  for (const m of movRes.data as (MovimentacaoCofrinho & { cofrinho_id: string })[]) {
    const lista = movPorCofrinho.get(m.cofrinho_id) ?? [];
    lista.push({ valor: m.valor, tipo: m.tipo, data: m.data });
    movPorCofrinho.set(m.cofrinho_id, lista);
  }

  return (
    <div className="grid gap-6">
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

      {ORDEM_HORIZONTE.map((h) => {
        const doGrupo = cofrinhos.filter((c) => c.horizonte === h);
        if (doGrupo.length === 0) return null;
        return (
          <section key={h} className="grid gap-3">
            <h2 className="text-xs uppercase tracking-widest" style={{ color: "var(--grafite)" }}>
              {ROTULO_HORIZONTE[h]}
            </h2>
            <div className="grid gap-3 md:grid-cols-2">
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
