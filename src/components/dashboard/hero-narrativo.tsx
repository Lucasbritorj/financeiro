import type { SegmentoFrase } from "@/lib/insights";

// O elemento-assinatura do Ateliê (modelo §2): o mês resumido numa frase
// serifada, valores em ouro/mono. Montada por regras em insights.ts —
// instantânea, sem LLM. Server component: zero JS no cliente.

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
    <section className="border-b pb-8" style={{ borderColor: "var(--borda)" }}>
      <span className="eyebrow mb-4 block">seu mês até agora</span>
      <h1
        className="serifa max-w-[26ch] text-3xl font-normal leading-snug sm:text-4xl"
        style={{ color: "var(--giz)" }}
      >
        {frase.map((s, i) =>
          s.enfase ? (
            <span
              key={i}
              className="numero-soberano text-[0.88em] font-medium"
              style={{ color: COR_ENFASE[s.enfase] }}
            >
              {s.texto}
            </span>
          ) : (
            <span key={i}>{s.texto}</span>
          )
        )}
      </h1>
      <div className="mt-7 flex flex-wrap gap-x-10 gap-y-4">
        {stats.map((s) => (
          <div key={s.rotulo}>
            <p
              className="mb-1 text-xs uppercase tracking-widest"
              style={{ color: "var(--grafite)" }}
            >
              {s.rotulo}
            </p>
            <p
              className="numero-soberano text-xl"
              style={{ color: s.cor ?? "var(--giz)" }}
            >
              {s.valor}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}
