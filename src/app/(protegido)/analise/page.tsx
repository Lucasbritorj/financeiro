import { createClient } from "@/lib/supabase/server";
import { formatarCentavos } from "@/lib/money";
import { analisarFinancas } from "@/lib/analise";
import { nomeMes, deslocarMes } from "@/lib/insights";
import { mesCorrenteSaoPaulo, normalizarTransacoes } from "@/lib/dashboard-dados";
import { lerTodasPaginas } from "@/lib/leitura-paginada";
import CartaoObservacao from "@/components/analise/cartao-observacao";
import { hojeSaoPaulo } from "@/lib/data";

// Assistente de análise: leitura determinística dos gastos e ganhos.
// Não é chat — são observações geradas por regras sobre os agregados dos
// últimos 4 meses (o comparativo precisa de histórico).
function inicioJanela(mesISO: string): string {
  const [ano, mes] = mesISO.split("-").map(Number);
  return new Date(Date.UTC(ano, mes - 1 - 3, 1)).toISOString().slice(0, 10);
}

export default async function AnalisePage() {
  const supabase = await createClient();
  const mes = mesCorrenteSaoPaulo();
  const hoje = hojeSaoPaulo();

  const data = await lerTodasPaginas((cursor, tamanho) => {
    let consulta = supabase
    .from("transacoes_origem")
    .select(
      "id, descricao, valor_total, tipo, data_compra, natureza, categorias(id, nome, cor, orcamento_mensal)"
    )
    .gte("data_compra", inicioJanela(mes))
    .lt("data_compra", `${deslocarMes(mes, 1)}-01`)
    .order("id").limit(tamanho);
    if (cursor) consulta = consulta.gt("id", cursor);
    return consulta.abortSignal(AbortSignal.timeout(15000));
  });

  const transacoes = normalizarTransacoes(data);

  const observacoes = analisarFinancas(transacoes, {
    mesISO: mes,
    hojeISO: hoje,
    formatar: formatarCentavos,
    limite: 8,
  });

  return (
    <div className="grid gap-6">
      <div className="grid gap-1">
        <h1 className="serifa text-2xl font-medium">Análise</h1>
        <p className="text-sm" style={{ color: "var(--grafite)" }}>
          Uma leitura dos seus números em {nomeMes(mes)} — tendências, limites e
          padrões. Tudo calculado a partir das suas transações, sem enviar nada
          para fora.
        </p>
      </div>

      {observacoes.length === 0 ? (
        <p className="text-sm" style={{ color: "var(--grafite)" }}>
          Ainda não há movimento suficiente neste mês para analisar. Lance ou
          importe algumas transações e volte aqui.
        </p>
      ) : (
        <div className="grid gap-3">
          {observacoes.map((o) => (
            <CartaoObservacao key={o.id} observacao={o} />
          ))}
        </div>
      )}
    </div>
  );
}
