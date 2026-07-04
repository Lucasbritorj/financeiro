import { createClient } from "@/lib/supabase/server";
import { formatarCentavos, formatarCompetencia, formatarData } from "@/lib/money";

const ESTILO_STATUS: Record<string, string> = {
  ABERTA: "bg-emerald-100 text-emerald-800",
  FECHADA: "bg-amber-100 text-amber-800",
  PAGA: "bg-zinc-200 text-zinc-700",
};

export default async function FaturasPage() {
  const supabase = await createClient();
  const [faturasRes, totaisRes] = await Promise.all([
    supabase
      .from("faturas")
      .select(
        "*, cartoes_credito(nome), parcelas(id, numero, valor, status, transacoes_origem(descricao, num_parcelas, tipo))"
      )
      .order("competencia", { ascending: false }),
    // Fonte única do total: a view aplica o sinal (RECEITA/estorno abate).
    supabase.from("vw_faturas_consolidadas").select("id, valor_total_fatura"),
  ]);
  if (faturasRes.error) throw new Error(faturasRes.error.message);
  if (totaisRes.error) throw new Error(totaisRes.error.message);
  const faturas = faturasRes.data;
  const totais = new Map(totaisRes.data.map((t) => [t.id, t.valor_total_fatura]));

  return (
    <div className="grid gap-6">
      <h1 className="text-xl font-semibold">Faturas</h1>
      {faturas.length === 0 ? (
        <p className="text-sm text-zinc-500">
          Nenhuma fatura ainda — registre uma compra no crédito.
        </p>
      ) : (
        <ul className="grid gap-4">
          {faturas.map((f) => {
            const parcelas = [...(f.parcelas ?? [])].sort((a, b) => a.numero - b.numero);
            const total = totais.get(f.id) ?? 0;
            return (
              <li key={f.id} className="rounded-lg border border-zinc-200 bg-white p-4">
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <span className="font-medium">
                    {f.cartoes_credito?.nome} · {formatarCompetencia(f.competencia)}
                  </span>
                  <span
                    className={`rounded px-1.5 py-0.5 text-xs ${
                      ESTILO_STATUS[f.status] ?? "bg-zinc-100 text-zinc-600"
                    }`}
                  >
                    {f.status}
                  </span>
                  <span className="text-xs text-zinc-500">
                    Vence em {formatarData(f.data_vencimento)}
                  </span>
                  <span className="ml-auto font-semibold">{formatarCentavos(total)}</span>
                </div>
                {parcelas.length > 0 && (
                  <ul className="mt-3 grid gap-1 border-t border-zinc-100 pt-3 text-sm">
                    {parcelas.map((p) => {
                      const ehEstorno = p.transacoes_origem?.tipo === "RECEITA";
                      return (
                        <li key={p.id} className="flex gap-2">
                          <span>
                            {p.transacoes_origem?.descricao}
                            {(p.transacoes_origem?.num_parcelas ?? 1) > 1 &&
                              ` (${p.numero}/${p.transacoes_origem?.num_parcelas})`}
                          </span>
                          <span
                            className={`ml-auto tabular-nums ${
                              ehEstorno ? "text-emerald-700" : ""
                            }`}
                          >
                            {ehEstorno && "-"}
                            {formatarCentavos(p.valor)}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
