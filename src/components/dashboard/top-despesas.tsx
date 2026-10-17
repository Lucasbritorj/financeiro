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
    <ol className="grid min-w-0 gap-2">
      {despesas.map((d, i) => (
        <li
          key={`${d.descricao}-${d.data_compra}-${i}`}
          className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-x-2 gap-y-1 border-b pb-2 last:border-b-0"
          style={{ borderColor: "var(--borda)" }}
        >
          <span className="numero-soberano row-span-2 text-xs" style={{ color: "var(--grafite)" }}>
            {i + 1}
          </span>
          <span className="col-start-2 min-w-0 truncate text-sm" title={d.descricao}>{d.descricao}</span>
          <span className="col-start-2 row-start-2 min-w-0 text-xs [overflow-wrap:anywhere]" style={{ color: "var(--grafite)" }}>
            {d.categoria?.nome ?? "—"} · {formatarData(d.data_compra)}
          </span>
          <span className="numero-soberano col-start-3 row-span-2 row-start-1 self-center whitespace-nowrap text-right text-sm">{formatarCentavos(d.valor_total)}</span>
        </li>
      ))}
    </ol>
  );
}
