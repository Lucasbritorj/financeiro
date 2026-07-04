"use client";

import { motion } from "framer-motion";
import { formatarCentavos } from "@/lib/money";
import type { Anomalia } from "@/lib/fluxo";

const MOLA = { type: "spring" as const, stiffness: 300, damping: 30 };

// Insight sofisticado, não alarmista: informa o desvio e a base de
// comparação; nenhum vermelho gritante, só âmbar contido.
export default function PainelAnomalia({ anomalia }: { anomalia: Anomalia | null }) {
  if (!anomalia) return null;
  const [ano, mes] = anomalia.mes.split("-");

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={MOLA}
      className="rounded-xl border px-4 py-3 text-sm"
      style={{
        borderColor: "rgba(224, 176, 108, 0.25)",
        background: "rgba(224, 176, 108, 0.06)",
        color: "#e0b06c",
      }}
    >
      <p className="font-medium">Anomalia financeira detectada</p>
      <p className="mt-1" style={{ color: "var(--texto-suave)" }}>
        Saídas de {mes}/{ano} somam{" "}
        <span className="numero-soberano">{formatarCentavos(anomalia.saidas)}</span> —
        acima de 1,5x a média histórica de{" "}
        <span className="numero-soberano">
          {formatarCentavos(Math.round(anomalia.mediaAnterior))}
        </span>
        . Vale revisar os lançamentos do período.
      </p>
    </motion.div>
  );
}
