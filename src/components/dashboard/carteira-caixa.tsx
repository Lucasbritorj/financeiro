import { formatarCentavos, formatarData, formatarCompetencia } from "@/lib/money";

// Regime de CAIXA: o que está de fato na carteira agora, e as faturas
// futuras (compromissos do cartão) que ainda vão sair. Complementa a visão
// de competência ("onde gasto") sem duplicar: compra no crédito só bate no
// caixa quando a fatura é paga.
export type FaturaFutura = {
  id: string;
  competencia: string;
  data_vencimento: string;
  status: string;
  valor_total_fatura: number;
};

export default function CarteiraCaixa({
  saldoCaixa,
  entradas,
  saidasAvista,
  faturasPagas,
  proximasFaturas,
}: {
  saldoCaixa: number;
  entradas: number;
  saidasAvista: number;
  faturasPagas: number;
  proximasFaturas: FaturaFutura[];
}) {
  const totalFuturo = proximasFaturas.reduce((s, f) => s + f.valor_total_fatura, 0);

  return (
    <div className="grid gap-5 lg:grid-cols-[0.85fr_1.15fr]">
      <section className="vidro-soberano p-6">
        <header className="mb-4 flex items-baseline justify-between">
          <h2 className="serifa text-lg font-medium">Carteira</h2>
          <span className="text-xs" style={{ color: "var(--grafite)" }}>
            saldo de caixa
          </span>
        </header>
        <p
          className="numero-soberano text-3xl font-medium"
          style={{ color: saldoCaixa >= 0 ? "var(--verde)" : "var(--telha)" }}
        >
          {formatarCentavos(saldoCaixa)}
        </p>
        <dl className="mt-5 grid gap-2 text-sm">
          <div className="flex justify-between">
            <dt style={{ color: "var(--grafite)" }}>Entradas</dt>
            <dd className="numero-soberano" style={{ color: "var(--verde)" }}>
              +{formatarCentavos(entradas)}
            </dd>
          </div>
          <div className="flex justify-between">
            <dt style={{ color: "var(--grafite)" }}>Gastos à vista (pix/débito/dinheiro)</dt>
            <dd className="numero-soberano">−{formatarCentavos(saidasAvista)}</dd>
          </div>
          <div className="flex justify-between">
            <dt style={{ color: "var(--grafite)" }}>Faturas pagas</dt>
            <dd className="numero-soberano">−{formatarCentavos(faturasPagas)}</dd>
          </div>
        </dl>
        <p className="mt-4 text-xs leading-relaxed" style={{ color: "var(--grafite)" }}>
          Compras no crédito não saem do caixa na hora — só quando você paga a
          fatura. Por isso a compra parcelada e o pagamento da fatura não contam
          em dobro.
        </p>
      </section>

      <section className="vidro-soberano p-6">
        <header className="mb-4 flex items-baseline justify-between">
          <h2 className="serifa text-lg font-medium">Próximas faturas</h2>
          <span className="numero-soberano text-xs" style={{ color: "var(--grafite)" }}>
            {totalFuturo > 0 ? `total ${formatarCentavos(totalFuturo)}` : "—"}
          </span>
        </header>
        {proximasFaturas.length === 0 ? (
          <p className="text-sm" style={{ color: "var(--grafite)" }}>
            Nenhuma fatura em aberto. Compras no crédito aparecem aqui, na
            competência em que vão vencer.
          </p>
        ) : (
          <ul className="grid gap-2">
            {proximasFaturas.map((f) => (
              <li
                key={f.id}
                className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b pb-2 last:border-b-0"
                style={{ borderColor: "var(--borda)" }}
              >
                <span className="font-medium">{formatarCompetencia(f.competencia)}</span>
                <span
                  className={`selo ${f.status === "FECHADA" ? "selo-fechada" : "selo-aberta"}`}
                >
                  {f.status === "FECHADA" ? "fechada" : "aberta"}
                </span>
                <span className="text-xs" style={{ color: "var(--grafite)" }}>
                  vence {formatarData(f.data_vencimento)}
                </span>
                <span className="numero-soberano ml-auto font-medium">
                  {formatarCentavos(f.valor_total_fatura)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
