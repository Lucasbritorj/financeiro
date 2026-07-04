"use client";

import { useEffect, useRef } from "react";
import {
  AreaSeries,
  ColorType,
  CrosshairMode,
  createChart,
} from "lightweight-charts";
import { formatarCentavos } from "@/lib/money";
import type { PontoFluxo } from "@/lib/fluxo";

// Posição acumulada por competência — TradingView Lightweight Charts com
// crosshair magnético e canvas próprio (60fps sem tocar no React).
export default function GraficoFluxo({ pontos }: { pontos: PontoFluxo[] }) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || pontos.length === 0) return;

    const chart = createChart(container, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: "#6f8296",
        fontFamily: "var(--font-geist-mono), monospace",
        attributionLogo: false,
      },
      grid: {
        vertLines: { color: "rgba(148, 180, 212, 0.06)" },
        horzLines: { color: "rgba(148, 180, 212, 0.06)" },
      },
      crosshair: {
        mode: CrosshairMode.Magnet,
        vertLine: { color: "rgba(76, 201, 166, 0.4)", labelBackgroundColor: "#10151a" },
        horzLine: { color: "rgba(76, 201, 166, 0.4)", labelBackgroundColor: "#10151a" },
      },
      localization: {
        priceFormatter: (reais: number) => formatarCentavos(Math.round(reais * 100)),
      },
      rightPriceScale: { borderVisible: false },
      timeScale: { borderVisible: false },
      handleScale: true, // pinch-to-zoom e wheel nativos
      handleScroll: true,
    });

    const serie = chart.addSeries(AreaSeries, {
      lineColor: "#4cc9a6",
      lineWidth: 2,
      topColor: "rgba(76, 201, 166, 0.28)",
      bottomColor: "rgba(76, 201, 166, 0.0)",
      priceLineVisible: false,
    });
    serie.setData(
      pontos.map((p) => ({ time: `${p.mes}-01`, value: p.acumulado / 100 }))
    );
    chart.timeScale().fitContent();

    return () => chart.remove();
  }, [pontos]);

  if (pontos.length === 0) {
    return (
      <p className="py-10 text-center text-sm" style={{ color: "var(--texto-suave)" }}>
        Sem movimentos ainda — registre transações para ver a curva.
      </p>
    );
  }
  return <div ref={containerRef} className="h-64 w-full" />;
}
