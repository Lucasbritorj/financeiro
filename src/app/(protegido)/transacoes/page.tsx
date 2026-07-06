import { createClient } from "@/lib/supabase/server";
import NovaTransacaoForm from "@/components/nova-transacao-form";
import BotaoAcaoRpc from "@/components/botao-acao-rpc";
import { formatarCentavos, formatarData } from "@/lib/money";
import { LIMITE_TRANSACOES_LISTA } from "@/lib/constantes";

export default async function TransacoesPage() {
  const supabase = await createClient();

  const [cartoesRes, transacoesRes] = await Promise.all([
    supabase.from("cartoes_credito").select("id, nome").order("nome"),
    supabase
      .from("transacoes_origem")
      .select("id, descricao, valor_total, tipo, forma_pagamento, data_compra, num_parcelas")
      .order("created_at", { ascending: false })
      .limit(LIMITE_TRANSACOES_LISTA),
  ]);
  if (cartoesRes.error) throw new Error(cartoesRes.error.message);
  if (transacoesRes.error) throw new Error(transacoesRes.error.message);

  const cartoes = cartoesRes.data;
  const transacoes = transacoesRes.data;

  return (
    <div className="grid gap-6">
      <h1 className="text-xl font-semibold">Transações</h1>
      <NovaTransacaoForm cartoes={cartoes} />
      {transacoes.length === 0 ? (
        <p className="text-sm" style={{ color: "var(--texto-suave)" }}>
          Nenhuma transação registrada ainda.
        </p>
      ) : (
        <ul className="grid gap-2">
          {transacoes.map((t) => (
            <li
              key={t.id}
              className="vidro-soberano flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-3"
            >
              <span className="font-medium">{t.descricao}</span>
              <span className="text-xs" style={{ color: "var(--texto-suave)" }}>
                {formatarData(t.data_compra)} · {t.forma_pagamento}
                {t.num_parcelas > 1 ? ` · ${t.num_parcelas}x` : ""}
              </span>
              <span
                className="numero-soberano ml-auto font-medium"
                style={{ color: t.tipo === "RECEITA" ? "var(--acento)" : "var(--texto)" }}
              >
                {t.tipo === "RECEITA" ? "+" : "-"}
                {formatarCentavos(t.valor_total)}
              </span>
              <BotaoAcaoRpc
                acao={{ rpc: "excluir_transacao", args: { p_transacao_id: t.id } }}
                rotulo="Excluir"
                rotuloPendente="Excluindo..."
                confirmacao={`Excluir "${t.descricao}"? Parcelas pendentes saem das faturas.`}
                perigo
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
