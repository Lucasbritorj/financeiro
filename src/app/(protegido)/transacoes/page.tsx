import { createClient } from "@/lib/supabase/server";
import NovaTransacaoForm from "@/components/nova-transacao-form";
import { formatarCentavos, formatarData } from "@/lib/money";

export default async function TransacoesPage() {
  const supabase = await createClient();

  const [cartoesRes, transacoesRes] = await Promise.all([
    supabase.from("cartoes_credito").select("id, nome").order("nome"),
    supabase
      .from("transacoes_origem")
      .select("*, parcelas(numero, valor, data_competencia, status)")
      .order("created_at", { ascending: false })
      .limit(20),
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
        <p className="text-sm text-zinc-500">Nenhuma transação registrada ainda.</p>
      ) : (
        <ul className="grid gap-2">
          {transacoes.map((t) => (
            <li
              key={t.id}
              className="flex flex-wrap items-baseline gap-x-3 gap-y-1 rounded-lg border border-zinc-200 bg-white px-4 py-3"
            >
              <span className="font-medium">{t.descricao}</span>
              <span className="text-xs text-zinc-500">
                {formatarData(t.data_compra)} · {t.forma_pagamento}
                {t.num_parcelas > 1 ? ` · ${t.num_parcelas}x` : ""}
              </span>
              <span
                className={`ml-auto font-medium ${
                  t.tipo === "RECEITA" ? "text-emerald-700" : "text-zinc-900"
                }`}
              >
                {t.tipo === "RECEITA" ? "+" : "-"}
                {formatarCentavos(t.valor_total)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
