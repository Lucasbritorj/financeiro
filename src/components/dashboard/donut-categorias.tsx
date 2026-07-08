import { formatarCentavos } from "@/lib/money";
import type { GastoCategoria } from "@/lib/insights";

// "Para onde vai o dinheiro": donut SVG + ranking com barra de envelope
// (gasto/orçamento). Server component — o donut é aritmética de arcos,
// não precisa de biblioteca de gráfico.

const COR_FALLBACK = "#A69C8D"; // grafite p/ "Sem categoria"
const CIRCUNFERENCIA = 2 * Math.PI * 52;

export default function DonutCategorias({ categorias }: { categorias: GastoCategoria[] }) {
  const total = categorias.reduce((soma, c) => soma + c.gasto, 0);

  if (total === 0) {
    return (
      <p className="text-sm" style={{ color: "var(--grafite)" }}>
        Sem despesas neste mês ainda — lance uma transação ou importe um extrato
        para ver a distribuição por categoria.
      </p>
    );
  }

  // Arcos proporcionais via stroke-dasharray (mesma técnica do mockup).
  let offsetAcumulado = 0;
  const arcos = categorias.map((c) => {
    const fracao = c.gasto / total;
    const arco = {
      cor: c.cor ?? COR_FALLBACK,
      dash: fracao * CIRCUNFERENCIA,
      offset: offsetAcumulado,
    };
    offsetAcumulado += fracao * CIRCUNFERENCIA;
    return arco;
  });

  return (
    <div className="grid items-center gap-6 sm:grid-cols-[auto_1fr]">
      <div className="relative mx-auto h-[150px] w-[150px]">
        <svg
          viewBox="0 0 120 120"
          width="150"
          height="150"
          aria-label="Distribuição de gastos por categoria"
        >
          <g transform="rotate(-90 60 60)" fill="none" strokeWidth="15">
            <circle cx="60" cy="60" r="52" stroke="var(--pergaminho-2)" />
            {arcos.map((a, i) => (
              <circle
                key={i}
                cx="60"
                cy="60"
                r="52"
                stroke={a.cor}
                strokeDasharray={`${a.dash} ${CIRCUNFERENCIA - a.dash}`}
                strokeDashoffset={-a.offset}
              />
            ))}
          </g>
        </svg>
        <div className="absolute inset-0 grid place-content-center text-center">
          <span className="numero-soberano text-lg">{formatarCentavos(total)}</span>
          <span
            className="text-[0.62rem] uppercase tracking-widest"
            style={{ color: "var(--grafite)" }}
          >
            gasto
          </span>
        </div>
      </div>

      <ul className="grid w-full gap-3">
        {categorias.map((c) => {
          const estourou = c.orcamento != null && c.gasto > c.orcamento;
          const quase = !estourou && c.orcamento != null && c.gasto >= c.orcamento * 0.8;
          const pctBarra =
            c.orcamento != null
              ? Math.min((c.gasto / c.orcamento) * 100, 100)
              : (c.gasto / total) * 100;
          const corBarra = estourou
            ? "var(--telha)"
            : quase
              ? "var(--ouro)"
              : (c.cor ?? COR_FALLBACK);
          return (
            <li key={c.id ?? "sem"} className="grid grid-cols-[9px_1fr_auto] items-center gap-x-3">
              <span
                className="h-[9px] w-[9px] rounded-sm"
                style={{ background: c.cor ?? COR_FALLBACK }}
              />
              <span className="text-sm">
                {c.nome}
                {estourou && (
                  <b className="ml-2 text-xs font-semibold" style={{ color: "var(--telha)" }}>
                    estourou
                  </b>
                )}
                {quase && (
                  <b className="ml-2 text-xs font-semibold" style={{ color: "var(--ouro)" }}>
                    80%+
                  </b>
                )}
              </span>
              <span
                className="numero-soberano text-sm"
                style={{ color: estourou ? "var(--telha)" : "var(--giz)" }}
              >
                {formatarCentavos(c.gasto)}
                {c.orcamento != null && (
                  <small style={{ color: "var(--grafite)" }}>
                    {" "}
                    /{formatarCentavos(c.orcamento)}
                  </small>
                )}
              </span>
              <span className="envelope-trilha col-start-2 col-end-4 mt-1.5">
                <i style={{ width: `${pctBarra}%`, background: corBarra }} />
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
