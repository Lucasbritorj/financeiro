import { createClient } from "@/lib/supabase/server";
import { formatarCentavos, formatarCompetencia, formatarData } from "@/lib/money";

const ESTILO_STATUS: Record<string, string> = {
  ABERTA: "bg-emerald-100 text-emerald-800",
  FECHADA: "bg-amber-100 text-amber-800",
  PAGA: "bg-zinc-200 text-zinc-700",
};

export default async function FaturasPage() {
  const supabase = await createClient();
  const { data: faturas, error } = await supabase
    .from("faturas")
    .select(
      "*, cartoes_credito(nome), parcelas(id, numero, valor, status, transacoes_origem(descricao, num_parcelas))"
    )
    .order("competencia", { ascending: false });
  if (error) throw new Error(error.message);

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
            const total = parcelas.reduce((soma, p) => soma + p.valor, 0);
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
                    {parcelas.map((p) => (
                      <li key={p.id} className="flex gap-2">
                        <span>
                          {p.transacoes_origem?.descricao}
                          {(p.transacoes_origem?.num_parcelas ?? 1) > 1 &&
                            ` (${p.numero}/${p.transacoes_origem?.num_parcelas})`}
                        </span>
                        <span className="ml-auto tabular-nums">
                          {formatarCentavos(p.valor)}
                        </span>
                      </li>
                    ))}
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
