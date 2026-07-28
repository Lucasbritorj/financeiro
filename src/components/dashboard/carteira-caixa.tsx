import { formatarCentavos, formatarData, formatarCompetencia } from "@/lib/money";
import { hojeSaoPaulo } from "@/lib/data";
import BotaoAcaoRpc from "@/components/botao-acao-rpc";

// Regime de CAIXA: o que está de fato na carteira agora, e as CONTAS A PAGAR
// (faturas de cartão + boletos) que ainda vão sair. Faturas e boletos têm a
// mesma natureza — obrigação com vencimento — e por isso vivem na mesma lista.
// Compra no crédito / boleto só bate no caixa quando pago: sem duplicata.
export type ContaAPagar = {
  tipo: string; // FATURA | BOLETO
  origem_id: string;
  transacao_id: string | null;
  descricao: string;
  competencia: string;
  data_vencimento: string;
  status: string; // ABERTA | FECHADA | A_PAGAR
  valor: number;
};

export default function CarteiraCaixa({
  saldoCaixa,
  entradas,
  saidasAvista,
  faturasPagas,
  boletosPagos,
  contasAPagar,
}: {
  saldoCaixa: number;
  entradas: number;
  saidasAvista: number;
  faturasPagas: number;
  boletosPagos: number;
  contasAPagar: ContaAPagar[];
}) {
  const totalFuturo = contasAPagar.reduce((s, c) => s + c.valor, 0);
  const hoje = hojeSaoPaulo();

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
          <div className="flex justify-between">
            <dt style={{ color: "var(--grafite)" }}>Boletos pagos</dt>
            <dd className="numero-soberano">−{formatarCentavos(boletosPagos)}</dd>
          </div>
        </dl>
        <p className="mt-4 text-xs leading-relaxed" style={{ color: "var(--grafite)" }}>
          Compras no crédito e boletos não saem do caixa na hora — só quando você
          paga. Por isso o gasto e o pagamento nunca contam em dobro.
        </p>
      </section>

      <section className="vidro-soberano p-6">
        <header className="mb-4 flex items-baseline justify-between">
          <h2 className="serifa text-lg font-medium">Contas a pagar</h2>
          <span className="numero-soberano text-xs" style={{ color: "var(--grafite)" }}>
            {totalFuturo > 0 ? `total ${formatarCentavos(totalFuturo)}` : "—"}
          </span>
        </header>
        {contasAPagar.length === 0 ? (
          <p className="text-sm" style={{ color: "var(--grafite)" }}>
            Nada a pagar. Faturas de cartão e boletos (luz, água, gás…) aparecem
            aqui, ordenados por vencimento.
          </p>
        ) : (
          <ul className="grid gap-2">
            {contasAPagar.map((c) => {
              const vencido = c.data_vencimento < hoje;
              const chave = `${c.tipo}-${c.origem_id}`;
              return (
                <li
                  key={chave}
                  className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b pb-2 last:border-b-0"
                  style={{ borderColor: "var(--borda)" }}
                >
                  <span className={`selo ${c.tipo === "BOLETO" ? "selo-boleto" : "selo-fatura"}`}>
                    {c.tipo === "BOLETO" ? "boleto" : "fatura"}
                  </span>
                  <span className="font-medium">{c.descricao}</span>
                  <span className="text-xs" style={{ color: "var(--grafite)" }}>
                    {formatarCompetencia(c.competencia)}
                  </span>
                  <span
                    className="text-xs"
                    style={{ color: vencido ? "var(--telha)" : "var(--grafite)" }}
                  >
                    {vencido ? "venceu" : "vence"} {formatarData(c.data_vencimento)}
                  </span>
                  <span className="numero-soberano ml-auto font-medium">
                    {formatarCentavos(c.valor)}
                  </span>
                  {c.tipo === "BOLETO" && c.transacao_id ? (
                    <BotaoAcaoRpc
                      acao={{ rpc: "pagar_boleto", args: { p_transacao_id: c.transacao_id } }}
                      rotulo="Pagar"
                      rotuloPendente="Pagando..."
                      tituloConfirmacao="Pagar boleto"
                      confirmacao={`Marcar "${c.descricao}" como pago? Sai da carteira.`}
                      sucesso="Boleto pago."
                    />
                  ) : (
                    <BotaoAcaoRpc
                      acao={{ rpc: "processar_pagamento_fatura", args: { p_fatura_id: c.origem_id } }}
                      rotulo="Pagar"
                      rotuloPendente="Pagando..."
                      tituloConfirmacao="Pagar fatura"
                      confirmacao={`Marcar a fatura de ${formatarCompetencia(c.competencia)} como paga? As parcelas serão quitadas e sai da carteira.`}
                      sucesso="Fatura paga."
                    />
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
