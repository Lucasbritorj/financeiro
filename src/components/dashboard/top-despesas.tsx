import { formatarCentavos, formatarData } from "@/lib/money";
import type { TransacaoInsight } from "@/lib/insights";

// Top despesas do mês — server component.
export default function TopDespesas({ despesas }: { despesas: TransacaoInsight[] }) {
  if (despesas.length === 0) {
    return (
      <p className="text-sm" style={{ color: "var(--grafite)" }}>
        Sem despesas neste mês.
      </p>
    );
  }
  return (
    <ol className="grid gap-2">
      {despesas.map((d, i) => (
        <li
          key={`${d.descricao}-${d.data_compra}-${i}`}
          className="flex items-baseline gap-3 border-b pb-2 last:border-b-0"
          style={{ borderColor: "var(--borda)" }}
        >
          <span className="numero-soberano text-xs" style={{ color: "var(--grafite)" }}>
            {i + 1}
          </span>
          <span className="min-w-0 flex-1 truncate text-sm">{d.descricao}</span>
          <span className="text-xs" style={{ color: "var(--grafite)" }}>
            {d.categoria?.nome ?? "—"} · {formatarData(d.data_compra)}
          </span>
          <span className="numero-soberano text-sm">{formatarCentavos(d.valor_total)}</span>
        </li>
      ))}
    </ol>
  );
}
