import type { Observacao, Severidade } from "@/lib/analise";

// Card de uma observação da análise. Barra lateral + métrica na cor da
// severidade; corpo reusa os segmentos com ênfase (ouro/verde/telha).
const COR: Record<Severidade, string> = {
  alerta: "var(--telha)",
  atencao: "var(--ouro)",
  positivo: "var(--verde)",
  neutro: "var(--grafite)",
};

const ROTULO: Record<Severidade, string> = {
  alerta: "atenção urgente",
  atencao: "de olho",
  positivo: "boa notícia",
  neutro: "leitura",
};

const COR_ENFASE = {
  ouro: "var(--ouro)",
  verde: "var(--verde)",
  telha: "var(--telha)",
} as const;

export default function CartaoObservacao({ observacao }: { observacao: Observacao }) {
  const cor = COR[observacao.severidade];
  return (
    <article
      className="vidro-soberano flex gap-4 p-5"
      style={{ borderLeft: `3px solid ${cor}` }}
    >
      <div className="min-w-0 flex-1">
        <div className="mb-1 flex items-center gap-2">
          <span
            className="text-[0.62rem] uppercase tracking-widest"
            style={{ color: cor }}
          >
            {ROTULO[observacao.severidade]}
          </span>
        </div>
        <h3 className="serifa mb-2 text-lg font-medium">{observacao.titulo}</h3>
        <p className="text-sm leading-relaxed" style={{ color: "var(--grafite)" }}>
          {observacao.segmentos.map((s, i) =>
            s.enfase ? (
              <span
                key={i}
                className="numero-soberano font-medium"
                style={{ color: COR_ENFASE[s.enfase] }}
              >
                {s.texto}
              </span>
            ) : (
              <span key={i} style={{ color: "var(--giz)" }}>
                {s.texto}
              </span>
            )
          )}
        </p>
      </div>
      {observacao.metrica && (
        <div
          className="numero-soberano flex-none self-start rounded-lg px-2.5 py-1 text-sm font-medium"
          style={{ background: "var(--pergaminho-2)", color: cor }}
        >
          {observacao.metrica}
        </div>
      )}
    </article>
  );
}
