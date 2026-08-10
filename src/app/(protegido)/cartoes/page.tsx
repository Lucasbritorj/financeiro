import { createClient } from "@/lib/supabase/server";
import NovoCartaoForm from "@/components/novo-cartao-form";
import BotaoAcaoRpc from "@/components/botao-acao-rpc";
import { formatarCentavos } from "@/lib/money";
import { LIMITE_CARTOES_LISTA } from "@/lib/constantes";

export default async function CartoesPage() {
  const supabase = await createClient();
  const { data: cartoes, error } = await supabase
    .from("cartoes_credito")
    .select("id, nome, limite_total, dia_fechamento, dia_vencimento")
    .order("created_at", { ascending: true })
    .limit(LIMITE_CARTOES_LISTA);
  if (error) throw new Error(error.message);

  return (
    <div className="grid gap-6">
      <h1 className="text-xl font-semibold">Cartões de crédito</h1>
      <NovoCartaoForm />
      {cartoes.length === 0 ? (
        <p className="text-sm" style={{ color: "var(--grafite)" }}>
          Nenhum cartão cadastrado ainda.
        </p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {cartoes.map((c) => (
            <li key={c.id} className="vidro-soberano p-4">
              <div className="flex items-baseline justify-between">
                <p className="font-medium">{c.nome}</p>
                <BotaoAcaoRpc
                  acao={{ rpc: "excluir_cartao", args: { p_cartao_id: c.id } }}
                  rotulo="Excluir"
                  rotuloPendente="Excluindo..."
                  confirmacao={`Excluir o cartão "${c.nome}"? O histórico de faturas permanece.`}
                  perigo
                />
              </div>
              <p className="numero-soberano mt-1 text-sm" style={{ color: "var(--verde)" }}>
                Limite {formatarCentavos(c.limite_total)}
              </p>
              <p className="text-sm" style={{ color: "var(--grafite)" }}>
                Fecha dia {c.dia_fechamento} · Vence dia {c.dia_vencimento}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
