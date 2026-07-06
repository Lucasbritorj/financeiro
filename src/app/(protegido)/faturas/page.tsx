import { createClient } from "@/lib/supabase/server";
import BotaoAcaoRpc from "@/components/botao-acao-rpc";
import { formatarCentavos, formatarCompetencia, formatarData } from "@/lib/money";
import { LIMITE_FATURAS_LISTA } from "@/lib/constantes";

const CLASSE_SELO: Record<string, string> = {
  ABERTA: "selo selo-aberta",
  FECHADA: "selo selo-fechada",
  PAGA: "selo selo-paga",
};

export default async function FaturasPage() {
  const supabase = await createClient();
  const faturasRes = await supabase
    .from("faturas")
    .select(
      "id, status, competencia, data_vencimento, cartoes_credito(nome), parcelas(id, numero, valor, status, transacoes_origem(descricao, num_parcelas, tipo))"
    )
    .order("competencia", { ascending: false })
    .limit(LIMITE_FATURAS_LISTA);
  if (faturasRes.error) throw new Error(faturasRes.error.message);
  // Fatura sem parcela ativa (ex.: sobra de transação excluída) é ruído.
  const faturas = faturasRes.data.filter((f) => (f.parcelas ?? []).length > 0);

  // Fonte única do total: a view aplica o sinal (RECEITA/estorno abate).
  const totaisRes = await supabase
    .from("vw_faturas_consolidadas")
    .select("id, valor_total_fatura")
    .in("id", faturas.map((f) => f.id));
  if (totaisRes.error) throw new Error(totaisRes.error.message);
  const totais = new Map(totaisRes.data.map((t) => [t.id, t.valor_total_fatura]));

  return (
    <div className="grid gap-6">
      <h1 className="text-xl font-semibold">Faturas</h1>
      {faturas.length === 0 ? (
        <p className="text-sm" style={{ color: "var(--texto-suave)" }}>
          Nenhuma fatura com lançamentos — registre uma compra no crédito.
        </p>
      ) : (
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
                  <span className="text-xs" style={{ color: "var(--texto-suave)" }}>
                    Vence em {formatarData(f.data_vencimento)}
                  </span>
                  <span className="numero-soberano ml-auto font-semibold">
                    {formatarCentavos(total)}
                  </span>
                  {f.status !== "PAGA" && (
                    <BotaoAcaoRpc
                      acao={{ rpc: "processar_pagamento_fatura", args: { p_fatura_id: f.id } }}
                      rotulo="Pagar fatura"
                      rotuloPendente="Pagando..."
                      confirmacao={`Marcar a fatura de ${formatarCompetencia(f.competencia)} como PAGA? As parcelas serão quitadas.`}
                    />
                  )}
                </div>
                <ul
                  className="mt-3 grid gap-1 border-t pt-3 text-sm"
                  style={{ borderColor: "var(--vidro-borda)" }}
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
                          style={ehEstorno ? { color: "var(--acento)" } : undefined}
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
      )}
    </div>
  );
}
