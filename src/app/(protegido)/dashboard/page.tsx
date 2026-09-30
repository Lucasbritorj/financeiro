import Link from "next/link";
import { Suspense } from "react";
import { createClient } from "@/lib/supabase/server";
import { nomeMes } from "@/lib/insights";
import { hojeSaoPaulo } from "@/lib/data";
import {
  MESES_HISTORICO,
  mesCorrenteSaoPaulo,
  montarCarteira,
  montarPainel,
  normalizarTransacoes,
  resolverJanela,
  type LinhaTransacao,
} from "@/lib/dashboard-dados";
import HeroNarrativo from "@/components/dashboard/hero-narrativo";
import DonutCategorias from "@/components/dashboard/donut-categorias";
import TopDespesas from "@/components/dashboard/top-despesas";
import SeletorMes from "@/components/dashboard/seletor-mes";
import HistoricoMensal from "@/components/dashboard/historico-mensal";
import CarteiraCaixa, { type ContaAPagar } from "@/components/dashboard/carteira-caixa";
import CartaoObservacao from "@/components/analise/cartao-observacao";
import SemearCategorias from "@/components/semear-categorias";
import LetreiroBcb from "@/components/dashboard/letreiro-bcb";
import AplicadorRecorrencias from "@/components/dashboard/aplicador-recorrencias";
import FechamentoMensal from "@/components/dashboard/fechamento-mensal";
import { montarFechamentoMensal } from "@/lib/fechamento-mensal";

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ mes?: string }>;
}) {
  const supabase = await createClient();
  const sp = await searchParams;

  // Descobre o mês mais recente com lançamento (a competência mais alta):
  // é o default do dashboard, para nunca cair num mês vazio por acaso.
  const { data: ultimaTx } = await supabase
    .from("transacoes_origem")
    .select("data_compra")
    .order("data_compra", { ascending: false })
    .limit(1)
    .maybeSingle();

  const janela = resolverJanela({
    mesQuery: sp.mes,
    mesComDados: ultimaTx?.data_compra?.slice(0, 7) ?? null,
    mesCorrente: mesCorrenteSaoPaulo(),
  });

  // A janela do histórico já cobre o comparativo do herói e a análise.
  // gastoPorCategoria/resumoDoMes filtram por mês, então o histórico extra não
  // contamina donut/KPIs.
  const [{ data, error }, categoriasRes, carteiraRes, contasRes, cofrinhosRes] = await Promise.all([
    supabase
      .from("transacoes_origem")
      .select(
        // `natureza` (0023) é o que impede o pagamento de fatura importado do
        // extrato de somar junto com as compras que ele quita.
        "descricao, valor_total, tipo, data_compra, natureza, categorias(id, nome, cor, orcamento_mensal)"
      )
      .gte("data_compra", janela.inicioJanela)
      .lt("data_compra", janela.fimJanela)
      .order("data_compra", { ascending: false }),
    supabase.from("categorias").select("id, orcamento_mensal"),
    // Carteira (regime de caixa): uma linha só. Contas a pagar = faturas de
    // cartão não pagas ∪ boletos pendentes, unificadas por vencimento.
    supabase.from("vw_carteira").select("*").maybeSingle(),
    supabase
      .from("vw_contas_a_pagar")
      .select("tipo, origem_id, transacao_id, descricao, competencia, data_vencimento, status, valor")
      .order("data_vencimento", { ascending: true })
      .limit(8),
    supabase
      .from("cofrinhos")
      .select("saldo_atual, valor_alvo, data_alvo")
      .eq("arquivado", false),
  ]);

  if (error) {
    return (
      <p className="text-sm" style={{ color: "var(--telha)" }}>
        Falha ao carregar o dashboard: {error.message}
      </p>
    );
  }

  const { mes } = janela;
  const { categorias, despesas, historico, frase, stats, destaque, resumo, projecao } = montarPainel({
    transacoes: normalizarTransacoes(data as LinhaTransacao[]),
    janela,
    hojeISO: hojeSaoPaulo(),
  });
  const carteira = montarCarteira(carteiraRes.data);
  const precisaSemear = (categoriasRes.data?.length ?? 0) === 0;
  const fechamento = categoriasRes.error || cofrinhosRes.error
    ? null
    : montarFechamentoMensal({
        realizado: resumo.saidas,
        projecao,
        categorias: categoriasRes.data ?? [],
        cofrinhos: cofrinhosRes.data ?? [],
      });
  const temDestaque = destaque && destaque.id !== "estavel";

  return (
    <div className="flex flex-col gap-6">
      <AplicadorRecorrencias />
      {/* Letreiro de pregão: em Suspense para BCB lento/fora do ar não travar
          o dashboard — o resto da página renderiza e a faixa chega depois. */}
      <Suspense fallback={<div className="letreiro letreiro-vazio">Carregando indicadores do Banco Central…</div>}>
        <LetreiroBcb />
      </Suspense>

      {precisaSemear && <SemearCategorias />}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="serifa text-2xl font-medium">Dashboard</h1>
        <SeletorMes mes={mes} proximoAtivo={janela.proximoAtivo} />
      </div>

      <FechamentoMensal fechamento={fechamento} mes={nomeMes(mes)} />

      {temDestaque && (
        <Link href="/analise" className="group block mb-2 transition-transform hover:scale-[1.01]">
          <CartaoObservacao observacao={destaque} interativo />
        </Link>
      )}

      {/* Grid Bento Box */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">

        {/* Row 1: Hero + Distribuição lado a lado */}
        <div className="md:col-span-1 lg:col-span-2">
          <HeroNarrativo frase={frase} stats={stats} />
        </div>

        <section className="vidro-soberano p-6 md:col-span-1 lg:col-span-1 flex flex-col">
          <header className="mb-5 flex items-baseline justify-between">
            <h2 className="serifa text-lg font-medium">Distribuição</h2>
            <span className="text-xs" style={{ color: "var(--grafite)" }}>
              {nomeMes(mes)}
            </span>
          </header>
          <div className="flex-1 flex items-center justify-center">
            <DonutCategorias categorias={categorias} />
          </div>
        </section>

        {/* Row 2: Carteira Caixa (spans 2 cols on desktop) */}
        <div className="md:col-span-2 lg:col-span-3">
          <CarteiraCaixa
            saldoCaixa={carteira.saldoCaixa}
            entradas={carteira.entradas}
            saidasAvista={carteira.saidasAvista}
            faturasPagas={carteira.faturasPagas}
            boletosPagos={carteira.boletosPagos}
            contasAPagar={(contasRes.data as ContaAPagar[] | null) ?? []}
          />
        </div>

        {/* Row 3: Histórico Mensal */}
        <section className="vidro-soberano p-6 md:col-span-2 lg:col-span-2 flex flex-col">
          <header className="mb-5 flex items-baseline justify-between">
            <h2 className="serifa text-lg font-medium">Histórico</h2>
            <span className="text-xs" style={{ color: "var(--grafite)" }}>
              últimos {MESES_HISTORICO} meses · clique para navegar
            </span>
          </header>
          <div className="flex-1">
            <HistoricoMensal pontos={historico} mesSelecionado={mes} />
          </div>
        </section>

        {/* Top Despesas (na antiga vaga do donut, ao lado do Histórico) */}
        <section className="vidro-soberano p-6 md:col-span-2 lg:col-span-1 flex flex-col">
          <header className="mb-5 flex items-baseline justify-between">
            <h2 className="serifa text-lg font-medium">Maiores despesas</h2>
            <span className="text-xs" style={{ color: "var(--grafite)" }}>
              top 5 · {nomeMes(mes)} ·{" "}
              <Link href="/transacoes" className="underline-offset-2 hover:underline" style={{ color: "var(--ouro)" }}>
                ver todas
              </Link>
            </span>
          </header>
          <div className="flex-1">
            <TopDespesas despesas={despesas} />
          </div>
        </section>

      </div>
    </div>
  );
}
