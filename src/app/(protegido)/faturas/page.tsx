import { createClient } from "@/lib/supabase/server";
import BotaoAcaoRpc from "@/components/botao-acao-rpc";
import { formatarCentavos, formatarCompetencia, formatarData } from "@/lib/money";
import { LIMITE_FATURAS_LISTA } from "@/lib/constantes";

const CLASSE_SELO: Record<string, string> = {
  ABERTA: "selo selo-aberta",
  FECHADA: "selo selo-fechada",
  PAGA: "selo selo-paga",
};

type ContaAPagar = {
  tipo: string;
  origem_id: string;
  transacao_id: string | null;
  descricao: string;
  competencia: string;
  data_vencimento: string;
  status: string;
  valor: number;
};

function hojeSaoPaulo(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
}

export default async function ContasAPagarPage() {
  const supabase = await createClient();

  // Lista unificada (faturas de cartão não pagas ∪ boletos pendentes), o
  // resumo de "o que devo", ordenado por vencimento.
  const [contasRes, faturasRes, boletosPagosRes] = await Promise.all([
    supabase
      .from("vw_contas_a_pagar")
      .select("tipo, origem_id, transacao_id, descricao, competencia, data_vencimento, status, valor")
      .order("data_vencimento", { ascending: true }),
    // Detalhamento das faturas (parcelas por fatura) — extrato do cartão.
    supabase
      .from("faturas")
      .select(
        "id, status, competencia, data_vencimento, cartoes_credito(nome), parcelas(id, numero, valor, status, transacoes_origem(descricao, num_parcelas, tipo))"
      )
      .order("competencia", { ascending: false })
      .limit(LIMITE_FATURAS_LISTA),
    // Boletos já pagos (parcela PAGA): dão o "desfazer pagamento" (estorno) e o
    // "duplicar p/ próximo mês" (recorrência), já que somem de contas a pagar.
    supabase
      .from("parcelas")
      .select(
        "data_pagamento, transacoes_origem!inner(id, descricao, valor_total, data_vencimento, forma_pagamento, deleted_at)"
      )
      .eq("status", "PAGA")
      .eq("transacoes_origem.forma_pagamento", "BOLETO")
      .is("transacoes_origem.deleted_at", null)
      .order("data_pagamento", { ascending: false })
      .limit(8),
  ]);
  if (contasRes.error) throw new Error(contasRes.error.message);
  if (faturasRes.error) throw new Error(faturasRes.error.message);
  if (boletosPagosRes.error) throw new Error(boletosPagosRes.error.message);

  const contas = (contasRes.data as ContaAPagar[]) ?? [];
  const totalDevido = contas.reduce((s, c) => s + c.valor, 0);
  const hoje = hojeSaoPaulo();

  type BoletoPago = {
    data_pagamento: string | null;
    transacoes_origem: {
      id: string;
      descricao: string;
      valor_total: number;
      data_vencimento: string | null;
    };
  };
  const boletosPagos = (boletosPagosRes.data as unknown as BoletoPago[]) ?? [];

  // Fatura sem parcela ativa (ex.: sobra de transação excluída) é ruído.
  const faturas = faturasRes.data.filter((f) => (f.parcelas ?? []).length > 0);
  const totaisRes = await supabase
    .from("vw_faturas_consolidadas")
    .select("id, valor_total_fatura")
    .in("id", faturas.map((f) => f.id));
  if (totaisRes.error) throw new Error(totaisRes.error.message);
  const totais = new Map(totaisRes.data.map((t) => [t.id, t.valor_total_fatura]));

  return (
    <div className="grid gap-8">
      <div className="grid gap-6">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h1 className="serifa text-2xl font-medium">Contas a pagar</h1>
          <span className="numero-soberano text-sm" style={{ color: "var(--grafite)" }}>
            {totalDevido > 0 ? `total em aberto ${formatarCentavos(totalDevido)}` : "nada em aberto"}
          </span>
        </div>

        {contas.length === 0 ? (
          <p className="text-sm" style={{ color: "var(--grafite)" }}>
            Nada a pagar. Faturas de cartão e boletos (luz, água, gás…) aparecem
            aqui, ordenados por vencimento. Lance um boleto em Transações.
          </p>
        ) : (
          <ul className="grid gap-3">
            {contas.map((c) => {
              const vencido = c.data_vencimento < hoje;
              return (
                <li
                  key={`${c.tipo}-${c.origem_id}`}
                  className="vidro-soberano flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3"
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
                  <span className="numero-soberano ml-auto font-semibold">
                    {formatarCentavos(c.valor)}
                  </span>
                  {c.tipo === "BOLETO" && c.transacao_id ? (
                    <span className="inline-flex items-center gap-2">
                      <BotaoAcaoRpc
                        acao={{ rpc: "duplicar_boleto", args: { p_transacao_id: c.transacao_id } }}
                        rotulo="Duplicar"
                        rotuloPendente="Duplicando..."
                        tituloConfirmacao="Duplicar boleto"
                        confirmacao={`Criar uma cópia de "${c.descricao}" para o mês seguinte?`}
                        sucesso="Boleto duplicado para o próximo mês."
                      />
                      <BotaoAcaoRpc
                        acao={{ rpc: "pagar_boleto", args: { p_transacao_id: c.transacao_id } }}
                        rotulo="Pagar"
                        rotuloPendente="Pagando..."
                        tituloConfirmacao="Pagar boleto"
                        confirmacao={`Marcar "${c.descricao}" como pago? Sai da carteira.`}
                        sucesso="Boleto pago."
                      />
                    </span>
                  ) : (
                    <BotaoAcaoRpc
                      acao={{ rpc: "processar_pagamento_fatura", args: { p_fatura_id: c.origem_id } }}
                      rotulo="Pagar fatura"
                      rotuloPendente="Pagando..."
                      tituloConfirmacao="Pagar fatura"
                      confirmacao={`Marcar a fatura de ${formatarCompetencia(c.competencia)} como PAGA? As parcelas serão quitadas.`}
                      sucesso="Fatura paga."
                    />
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {boletosPagos.length > 0 && (
        <div className="grid gap-4">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <h2 className="serifa text-lg font-medium">Boletos pagos recentemente</h2>
            <span className="text-xs" style={{ color: "var(--grafite)" }}>
              desfaça um pagamento ou relance para o próximo mês
            </span>
          </div>
          <ul className="grid gap-3">
            {boletosPagos.map((b) => {
              const t = b.transacoes_origem;
              return (
                <li
                  key={t.id}
                  className="vidro-soberano flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3"
                >
                  <span className="selo selo-paga">pago</span>
                  <span className="font-medium">{t.descricao}</span>
                  {b.data_pagamento && (
                    <span className="text-xs" style={{ color: "var(--grafite)" }}>
                      pago em {formatarData(b.data_pagamento.slice(0, 10))}
                    </span>
                  )}
                  <span className="numero-soberano ml-auto font-semibold">
                    {formatarCentavos(t.valor_total)}
                  </span>
                  <BotaoAcaoRpc
                    acao={{ rpc: "duplicar_boleto", args: { p_transacao_id: t.id } }}
                    rotulo="Duplicar"
                    rotuloPendente="Duplicando..."
                    tituloConfirmacao="Duplicar boleto"
                    confirmacao={`Criar uma cópia de "${t.descricao}" para o mês seguinte?`}
                    sucesso="Boleto duplicado para o próximo mês."
                  />
                  <BotaoAcaoRpc
                    acao={{ rpc: "estornar_boleto", args: { p_transacao_id: t.id } }}
                    rotulo="Desfazer pagamento"
                    rotuloPendente="Desfazendo..."
                    tituloConfirmacao="Desfazer pagamento"
                    confirmacao={`Estornar o pagamento de "${t.descricao}"? Ele volta para contas a pagar e retorna à carteira.`}
                    sucesso="Pagamento desfeito."
                    perigo
                  />
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {faturas.length > 0 && (
        <div className="grid gap-4">
          <h2 className="serifa text-lg font-medium">Faturas do cartão (detalhe)</h2>
          <ul className="grid gap-4">
            {faturas.map((f) => {
              const parcelas = [...(f.parcelas ?? [])].sort((a, b) => a.numero - b.numero);
              const total = totais.get(f.id) ?? 0;
              return (
                <li key={f.id} className="vidro-soberano p-4">
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <span className="font-medium">
                      {f.cartoes_credito?.nome} · {formatarCompetencia(f.competencia)}
                    </span>
                    <span className={CLASSE_SELO[f.status] ?? "selo selo-paga"}>{f.status}</span>
                    <span className="text-xs" style={{ color: "var(--grafite)" }}>
                      Vence em {formatarData(f.data_vencimento)}
                    </span>
                    <span className="numero-soberano ml-auto font-semibold">
                      {formatarCentavos(total)}
                    </span>
                    {f.status !== "PAGA" ? (
                      <BotaoAcaoRpc
                        acao={{ rpc: "processar_pagamento_fatura", args: { p_fatura_id: f.id } }}
                        rotulo="Pagar fatura"
                        rotuloPendente="Pagando..."
                        tituloConfirmacao="Pagar fatura"
                        confirmacao={`Marcar a fatura de ${formatarCompetencia(f.competencia)} como PAGA? As parcelas serão quitadas.`}
                        sucesso="Fatura paga."
                      />
                    ) : (
                      <BotaoAcaoRpc
                        acao={{ rpc: "estornar_pagamento_fatura", args: { p_fatura_id: f.id } }}
                        rotulo="Desfazer pagamento"
                        rotuloPendente="Desfazendo..."
                        tituloConfirmacao="Desfazer pagamento"
                        confirmacao={`Estornar o pagamento da fatura de ${formatarCompetencia(f.competencia)}? As parcelas voltam a pendentes e ela retorna à carteira.`}
                        sucesso="Pagamento da fatura desfeito."
                        perigo
                      />
                    )}
                  </div>
                  <ul
                    className="mt-3 grid gap-1 border-t pt-3 text-sm"
                    style={{ borderColor: "var(--borda)" }}
                  >
                    {parcelas.map((p) => {
                      const ehEstorno = p.transacoes_origem?.tipo === "RECEITA";
                      return (
                        <li key={p.id} className="flex gap-2">
                          <span>
                            {p.transacoes_origem?.descricao}
                            {(p.transacoes_origem?.num_parcelas ?? 1) > 1 &&
                              ` (${p.numero}/${p.transacoes_origem?.num_parcelas})`}
                          </span>
                          <span
                            className="numero-soberano ml-auto"
                            style={ehEstorno ? { color: "var(--verde)" } : undefined}
                          >
                            {ehEstorno && "-"}
                            {formatarCentavos(p.valor)}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
