import Link from "next/link";
import { formatarCentavos } from "@/lib/money";

type Fechamento = {
  realizado: number;
  projecao: number;
  orcamentoTotal: number;
  diferencaOrcamento: number | null;
  quantidadeMetas: number;
  saldoMetas: number;
  alvoMetas: number;
};

export default function FechamentoMensal({
  fechamento,
  mes,
}: {
  fechamento: Fechamento | null;
  mes: string;
}) {
  if (fechamento === null) {
    return (
      <section className="vidro-soberano p-6" aria-labelledby="fechamento-titulo">
        <h2 id="fechamento-titulo" className="serifa text-lg font-medium">Fechamento mensal</h2>
        <p className="mt-2 text-sm" style={{ color: "var(--grafite)" }}>
          Orçamentos e metas estão indisponíveis agora. Suas transações continuam preservadas.
        </p>
      </section>
    );
  }

  const dentroDoOrcamento = fechamento.diferencaOrcamento == null || fechamento.diferencaOrcamento >= 0;
  return (
    <section className="vidro-soberano p-6" aria-labelledby="fechamento-titulo">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 id="fechamento-titulo" className="serifa text-lg font-medium">Fechamento mensal</h2>
          <p className="mt-1 text-sm" style={{ color: "var(--grafite)" }}>
            Realizado, projeção, orçamento e metas de {mes}.
          </p>
        </div>
        <Link href="/transacoes" className="text-sm hover:underline" style={{ color: "var(--ouro)" }}>
          Revisar despesas
        </Link>
      </div>

      <dl className="mt-5 grid gap-4 sm:grid-cols-3">
        <div>
          <dt className="text-xs uppercase tracking-widest" style={{ color: "var(--grafite)" }}>Realizado · projeção</dt>
          <dd className="numero-soberano mt-1 text-lg">{formatarCentavos(fechamento.realizado)} · {formatarCentavos(fechamento.projecao)}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-widest" style={{ color: "var(--grafite)" }}>Orçamento total</dt>
          <dd className="numero-soberano mt-1 text-lg">{fechamento.diferencaOrcamento == null ? "Defina nas categorias" : formatarCentavos(fechamento.orcamentoTotal)}</dd>
          {fechamento.diferencaOrcamento != null && (
            <p className="mt-1 text-sm" style={{ color: dentroDoOrcamento ? "var(--verde)" : "var(--telha)" }}>
              {dentroDoOrcamento ? `${formatarCentavos(fechamento.diferencaOrcamento)} disponíveis` : `${formatarCentavos(-fechamento.diferencaOrcamento)} acima da projeção`}
            </p>
          )}
        </div>
        <div>
          <dt className="text-xs uppercase tracking-widest" style={{ color: "var(--grafite)" }}>Metas · cofrinhos</dt>
          <dd className="numero-soberano mt-1 text-lg">{fechamento.quantidadeMetas === 0 ? "Nenhuma meta" : `${formatarCentavos(fechamento.saldoMetas)} de ${formatarCentavos(fechamento.alvoMetas)}`}</dd>
          <Link href="/cofrinhos" className="mt-1 inline-block text-sm hover:underline" style={{ color: "var(--ouro)" }}>
            {fechamento.quantidadeMetas === 0 ? "Criar cofrinho" : "Acompanhar aportes"}
          </Link>
        </div>
      </dl>
      <Link href="/categorias" className="mt-5 inline-block text-sm hover:underline" style={{ color: "var(--ouro)" }}>
        Ajustar envelopes de orçamento
      </Link>
    </section>
  );
}