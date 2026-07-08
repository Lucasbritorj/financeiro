import { createClient } from "@/lib/supabase/server";
import { formatarCentavos } from "@/lib/money";
import {
  resumoDoMes,
  gastoPorCategoria,
  topDespesas,
  montarFraseHeroi,
  taxaPoupanca,
  projecaoFechamento,
  type TransacaoInsight,
} from "@/lib/insights";
import HeroNarrativo, { type StatHero } from "@/components/dashboard/hero-narrativo";
import DonutCategorias from "@/components/dashboard/donut-categorias";
import TopDespesas from "@/components/dashboard/top-despesas";
import SemearCategorias from "@/components/semear-categorias";

// Base temporal do dashboard = data_compra (visão caixa "quanto gastei
// no mês"). Fuso de negócio São Paulo (CLAUDE.md).
function mesCorrenteSaoPaulo(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" })
    .format(new Date())
    .slice(0, 7);
}

function mesAnterior(mesISO: string): string {
  const [ano, mes] = mesISO.split("-").map(Number);
  const d = new Date(Date.UTC(ano, mes - 2, 1));
  return d.toISOString().slice(0, 7);
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

export default async function DashboardPage() {
  const supabase = await createClient();
  const mes = mesCorrenteSaoPaulo();
  const anterior = mesAnterior(mes);

  // Janela de 2 meses (corrente + anterior) para o comparativo; embed da
  // categoria via FK. RLS filtra usuário e soft-deletados.
  const { data, error } = await supabase
    .from("transacoes_origem")
    .select(
      "descricao, valor_total, tipo, data_compra, categorias(id, nome, cor, orcamento_mensal)"
    )
    .gte("data_compra", `${anterior}-01`)
    .order("data_compra", { ascending: false });

  if (error) {
    return (
      <p className="text-sm" style={{ color: "var(--telha)" }}>
        Falha ao carregar o dashboard: {error.message}
      </p>
    );
  }

  const { count: totalCategorias } = await supabase
    .from("categorias")
    .select("id", { count: "exact", head: true });

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

  const resumoAtual = resumoDoMes(transacoes, mes);
  const resumoAnterior = resumoDoMes(transacoes, anterior);
  const categorias = gastoPorCategoria(transacoes, mes);
  const despesas = topDespesas(transacoes, mes, 5);

  const frase = montarFraseHeroi({
    mesISO: mes,
    gastoMes: resumoAtual.saidas,
    gastoMesAnterior: resumoAnterior.saidas,
    categorias,
    formatar: formatarCentavos,
  });

  const diaAtual = Number(
    new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", day: "numeric" }).format(
      new Date()
    )
  );
  const diasNoMes = new Date(Number(mes.slice(0, 4)), Number(mes.slice(5, 7)), 0).getDate();
  const projecao = projecaoFechamento(resumoAtual.saidas, diaAtual, diasNoMes);
  const poupanca = taxaPoupanca(resumoAtual.entradas, resumoAtual.saidas);

  const stats: StatHero[] = [
    {
      rotulo: "Saldo do mês",
      valor: `${resumoAtual.saldo >= 0 ? "+" : ""}${formatarCentavos(resumoAtual.saldo)}`,
      cor: resumoAtual.saldo >= 0 ? "var(--verde)" : "var(--telha)",
    },
    {
      rotulo: "Taxa de poupança",
      valor: poupanca == null ? "—" : `${poupanca}%`,
    },
    {
      rotulo: "Projeção de fechamento",
      valor: formatarCentavos(projecao),
    },
    {
      rotulo: "Entrou · saiu",
      valor: `${formatarCentavos(resumoAtual.entradas)} · ${formatarCentavos(resumoAtual.saidas)}`,
    },
  ];

  return (
    <div className="grid gap-6">
      {(totalCategorias ?? 0) === 0 && <SemearCategorias />}

      <HeroNarrativo frase={frase} stats={stats} />

      <div className="grid gap-5 lg:grid-cols-[1.15fr_0.85fr]">
        <section className="vidro-soberano p-6">
          <header className="mb-5 flex items-baseline justify-between">
            <h2 className="serifa text-lg font-medium">Para onde vai o dinheiro</h2>
            <span className="text-xs" style={{ color: "var(--grafite)" }}>
              mês corrente · por categoria
            </span>
          </header>
          <DonutCategorias categorias={categorias} />
        </section>

        <section className="vidro-soberano p-6">
          <header className="mb-5 flex items-baseline justify-between">
            <h2 className="serifa text-lg font-medium">Maiores despesas</h2>
            <span className="text-xs" style={{ color: "var(--grafite)" }}>
              top 5 do mês
            </span>
          </header>
          <TopDespesas despesas={despesas} />
        </section>
      </div>
    </div>
  );
}
