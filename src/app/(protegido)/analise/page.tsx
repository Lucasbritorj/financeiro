import { createClient } from "@/lib/supabase/server";
import { formatarCentavos } from "@/lib/money";
import { analisarFinancas } from "@/lib/analise";
import { nomeMes, type TransacaoInsight } from "@/lib/insights";
import CartaoObservacao from "@/components/analise/cartao-observacao";

// Assistente de análise: leitura determinística dos gastos e ganhos.
// Não é chat — são observações geradas por regras sobre os agregados dos
// últimos 4 meses (o comparativo precisa de histórico).
function mesCorrenteSaoPaulo(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" })
    .format(new Date())
    .slice(0, 7);
}
function hojeSaoPaulo(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
}
function inicioJanela(mesISO: string): string {
  const [ano, mes] = mesISO.split("-").map(Number);
  return new Date(Date.UTC(ano, mes - 1 - 3, 1)).toISOString().slice(0, 10);
}

type LinhaTransacao = {
  descricao: string;
  valor_total: number;
  tipo: string;
  data_compra: string;
  categorias: {
    id: string;
    nome: string;
    cor: string | null;
    orcamento_mensal: number | null;
  } | null;
};

export default async function AnalisePage() {
  const supabase = await createClient();
  const mes = mesCorrenteSaoPaulo();
  const hoje = hojeSaoPaulo();

  const { data, error } = await supabase
    .from("transacoes_origem")
    .select(
      "descricao, valor_total, tipo, data_compra, categorias(id, nome, cor, orcamento_mensal)"
    )
    .gte("data_compra", inicioJanela(mes))
    .order("data_compra", { ascending: false });

  if (error) {
    return (
      <p className="text-sm" style={{ color: "var(--telha)" }}>
        Falha ao carregar a análise: {error.message}
      </p>
    );
  }

  const transacoes: TransacaoInsight[] = (data as LinhaTransacao[]).flatMap((t) => {
    if (t.tipo !== "DESPESA" && t.tipo !== "RECEITA") return [];
    return [
      {
        descricao: t.descricao,
        valor_total: t.valor_total,
        tipo: t.tipo,
        data_compra: t.data_compra,
        categoria: t.categorias,
      },
    ];
  });

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
