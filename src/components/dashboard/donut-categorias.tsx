"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { formatarCentavos } from "@/lib/money";
import type { GastoCategoria } from "@/lib/insights";
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from "recharts";

// "Para onde vai o dinheiro": donut interativo com Recharts + ranking com barra
// de envelope (gasto/orçamento). O card é estreito (meia coluna do dashboard):
// donut e legenda empilham SEMPRE — lado a lado não cabe sem espremer.

const COR_FALLBACK = "#A69C8D"; // grafite p/ "Sem categoria"

export default function DonutCategorias({ categorias }: { categorias: GastoCategoria[] }) {
  const router = useRouter();
  const total = categorias.reduce((soma, c) => soma + c.gasto, 0);

  if (total === 0) {
    return (
      <p className="text-sm" style={{ color: "var(--grafite)" }}>
        Sem despesas neste mês ainda — lance uma transação ou importe um extrato
        para ver a distribuição por categoria.
      </p>
    );
  }

  // id "sem" = filtro de transações sem categoria na lista.
  const arcos = categorias.map((c) => ({
    id: c.id ?? "sem",
    name: c.nome,
    gasto: c.gasto,
    cor: c.cor ?? COR_FALLBACK,
  }));

  // O rótulo central precisa caber no furo do anel (Ø 100px): valores longos
  // descem de corpo em vez de vazar por cima do traçado.
  const rotuloTotal = formatarCentavos(total);
  const tamanhoRotulo =
    rotuloTotal.length > 12 ? "text-xs" : rotuloTotal.length > 9 ? "text-sm" : "text-lg";

  return (
    <div className="grid gap-5">
      <div className="relative mx-auto h-[150px] w-[150px]">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={arcos}
              dataKey="gasto"
              cx="50%"
              cy="50%"
              innerRadius={50}
              outerRadius={65}
              stroke="var(--pergaminho-2)"
              strokeWidth={2}
              paddingAngle={2}
              isAnimationActive={true}
              animationBegin={200}
              animationDuration={800}
              style={{ cursor: "pointer" }}
              // Clicar na fatia abre a lista já filtrada pela categoria.
              onClick={(fatia) => {
                const id =
                  (fatia as { id?: string; payload?: { id?: string } }).id ??
                  (fatia as { payload?: { id?: string } }).payload?.id;
                if (id) router.push(`/transacoes?categoria=${id}`);
              }}
            >
              {arcos.map((a, index) => (
                <Cell key={`cell-${index}`} fill={a.cor} />
              ))}
            </Pie>
            <Tooltip
              formatter={(value) => formatarCentavos(Number(value))}
              contentStyle={{ 
                background: "var(--pergaminho)", 
                border: "1px solid var(--borda)", 
                borderRadius: "8px", 
                color: "var(--giz)",
                boxShadow: "var(--sombra-flutuante)"
              }}
              itemStyle={{ color: "var(--giz)" }}
            />
          </PieChart>
        </ResponsiveContainer>
        <div className="absolute inset-0 grid place-content-center overflow-hidden text-center pointer-events-none">
          <span className={`numero-soberano ${tamanhoRotulo}`}>{rotuloTotal}</span>
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
                <Link
                  href={`/transacoes?categoria=${c.id ?? "sem"}`}
                  className="underline-offset-2 hover:underline"
                  title={`Ver transações de ${c.nome}`}
                >
                  {c.nome}
                </Link>
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
