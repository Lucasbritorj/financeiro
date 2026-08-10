"use client";

import type { SegmentoFrase } from "@/lib/insights";
import { motion } from "framer-motion";

// O elemento-assinatura do Ateliê (modelo §2): o mês resumido numa frase
// serifada, valores em ouro/mono. Montada por regras em insights.ts.
// Agora com animação suave de entrada (Fintech Premium).

const COR_ENFASE: Record<NonNullable<SegmentoFrase["enfase"]>, string> = {
  ouro: "var(--ouro)",
  verde: "var(--verde)",
  telha: "var(--telha)",
};

export type StatHero = { rotulo: string; valor: string; cor?: string };

export default function HeroNarrativo({
  frase,
  stats,
}: {
  frase: SegmentoFrase[];
  stats: StatHero[];
}) {
  return (
    <motion.section 
      initial={{ opacity: 0, y: 15 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: "easeOut" }}
      className="border-b pb-9" 
      style={{ borderColor: "var(--borda)" }}
    >
      <span className="eyebrow mb-4 block">seu mês até agora</span>
      <h1
        className="serifa max-w-[24ch] text-3xl font-normal leading-[1.15] tracking-tight sm:text-4xl md:text-[2.9rem]"
        style={{ color: "var(--giz)" }}
      >
        {frase.map((s, i) =>
          s.enfase ? (
            <span
              key={i}
              className="numero-soberano text-[0.86em] font-medium"
              style={{ color: COR_ENFASE[s.enfase] }}
            >
              {s.texto}
            </span>
          ) : (
            <span key={i}>{s.texto}</span>
          )
        )}
      </h1>
      <motion.div 
        className="mt-8 flex flex-wrap gap-x-10 gap-y-5"
        initial="hidden"
        animate="visible"
        variants={{
          hidden: { opacity: 0 },
          visible: {
            opacity: 1,
            transition: { staggerChildren: 0.1, delayChildren: 0.2 }
          }
        }}
      >
        {stats.map((s) => (
          <motion.div 
            key={s.rotulo} 
            className="min-w-[7rem]"
            variants={{
              hidden: { opacity: 0, scale: 0.95 },
              visible: { opacity: 1, scale: 1, transition: { type: "spring", stiffness: 300, damping: 24 } }
            }}
          >
            <p
              className="mb-1.5 text-[0.68rem] uppercase tracking-[0.14em]"
              style={{ color: "var(--grafite)" }}
            >
              {s.rotulo}
            </p>
            <p
              className="numero-soberano text-2xl"
              style={{ color: s.cor ?? "var(--giz)" }}
            >
              {s.valor}
            </p>
          </motion.div>
        ))}
      </motion.div>
    </motion.section>
  );
}
