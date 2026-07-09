import Link from "next/link";
import { formatarCentavos } from "@/lib/money";
import { nomeMes } from "@/lib/insights";

// Histórico mensal: barras espelhadas (entradas ↑ verde, saídas ↓ telha)
// dos últimos meses, clicáveis para trocar o mês selecionado. Server
// component — SVG proporcional, sem biblioteca de gráfico.
export type PontoHistorico = { mes: string; entradas: number; saidas: number; saldo: number };

export default function HistoricoMensal({
  pontos,
  mesSelecionado,
}: {
  pontos: PontoHistorico[];
  mesSelecionado: string;
}) {
  const max = Math.max(1, ...pontos.map((p) => Math.max(p.entradas, p.saidas)));
  const temMovimento = pontos.some((p) => p.entradas > 0 || p.saidas > 0);

  if (!temMovimento) {
    return (
      <p className="text-sm" style={{ color: "var(--grafite)" }}>
        Ainda não há histórico para comparar. Lance transações em mais de um mês
        para ver a evolução aqui.
      </p>
    );
  }

  return (
    <div className="grid gap-3">
      <div className="flex items-end gap-2 sm:gap-3">
        {pontos.map((p) => {
          const sel = p.mes === mesSelecionado;
          const hEnt = `${(p.entradas / max) * 100}%`;
          const hSai = `${(p.saidas / max) * 100}%`;
          return (
            <Link
              key={p.mes}
              href={`/dashboard?mes=${p.mes}`}
              className="group flex flex-1 flex-col items-center gap-1.5"
              aria-label={`Ver ${nomeMes(p.mes)}: entradas ${formatarCentavos(p.entradas)}, saídas ${formatarCentavos(p.saidas)}`}
            >
              {/* colunas espelhadas: entradas para cima, saídas para baixo */}
              <div className="flex h-24 w-full flex-col justify-end">
                <div className="flex h-1/2 items-end justify-center">
                  <span
                    className="w-3/5 max-w-6 rounded-t transition-opacity group-hover:opacity-100"
                    style={{
                      height: hEnt,
                      background: "var(--verde)",
                      opacity: sel ? 1 : 0.55,
                    }}
                  />
                </div>
                <div
                  className="w-full"
                  style={{ height: 1, background: "var(--borda-forte)" }}
                />
                <div className="flex h-1/2 items-start justify-center">
                  <span
                    className="w-3/5 max-w-6 rounded-b transition-opacity group-hover:opacity-100"
                    style={{
                      height: hSai,
                      background: "var(--telha)",
                      opacity: sel ? 1 : 0.55,
                    }}
                  />
                </div>
              </div>
              <span
                className="text-[0.68rem] uppercase tracking-wide"
                style={{
                  color: sel ? "var(--giz)" : "var(--grafite)",
                  fontWeight: sel ? 600 : 400,
                }}
              >
                {nomeMes(p.mes).slice(0, 3)}
              </span>
            </Link>
          );
        })}
      </div>
      <div className="flex items-center gap-4 text-xs" style={{ color: "var(--grafite)" }}>
        <span className="inline-flex items-center gap-1.5">
          <i className="h-2.5 w-2.5 rounded-sm" style={{ background: "var(--verde)" }} /> entradas
        </span>
        <span className="inline-flex items-center gap-1.5">
          <i className="h-2.5 w-2.5 rounded-sm" style={{ background: "var(--telha)" }} /> saídas
        </span>
      </div>
    </div>
  );
}
