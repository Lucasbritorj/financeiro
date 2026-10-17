import Link from "next/link";
import { deslocarMes, nomeMes } from "@/lib/insights";

// Navegação de mês estilo mockup: ‹ [mês ano] › como links (?mes=YYYY-MM).
// Server component — SSR puro, sem estado no cliente. `proximoAtivo` desliga
// o avanço além do mês mais recente com dados / mês corrente.
export default function SeletorMes({
  mes,
  proximoAtivo,
  base='/dashboard',
}: {
  mes: string;
  proximoAtivo: boolean;
  base?: '/dashboard'|'/analise';
}) {
  const ano = mes.slice(0, 4);
  const anterior = deslocarMes(mes, -1);
  const proximo = deslocarMes(mes, 1);

  return (
    <div
      className="inline-flex items-center gap-3 rounded-full border px-2 py-1.5 pl-4"
      style={{ borderColor: "var(--borda)", background: "rgba(255,255,255,.015)" }}
    >
      <Link
        href={`${base}?mes=${anterior}`}
        aria-label="Mês anterior"
        className="grid h-8 w-8 place-items-center rounded-full border text-sm transition-colors hover:text-[var(--giz)]"
        style={{ borderColor: "var(--borda)", color: "var(--grafite)" }}
      >
        ‹
      </Link>
      <span className="serifa min-w-[7.5rem] text-center text-base">
        {nomeMes(mes)} {ano}
      </span>
      {proximoAtivo ? (
        <Link
          href={`${base}?mes=${proximo}`}
          aria-label="Próximo mês"
          className="grid h-8 w-8 place-items-center rounded-full border text-sm transition-colors hover:text-[var(--giz)]"
          style={{ borderColor: "var(--borda)", color: "var(--grafite)" }}
        >
          ›
        </Link>
      ) : (
        <span
          aria-hidden
          className="grid h-8 w-8 place-items-center rounded-full border text-sm opacity-30"
          style={{ borderColor: "var(--borda)", color: "var(--grafite)" }}
        >
          ›
        </span>
      )}
    </div>
  );
}
