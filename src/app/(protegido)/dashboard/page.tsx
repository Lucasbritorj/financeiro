import Link from "next/link";
import { Suspense } from "react";
import { createClient } from "@/lib/supabase/server";
import { formatarCentavos } from "@/lib/money";
import {
  resumoDoMes,
  gastoPorCategoria,
  topDespesas,
  montarFraseHeroi,
  taxaPoupanca,
  projecaoFechamento,
  deslocarMes,
  historicoMensal,
  nomeMes,
  type TransacaoInsight,
} from "@/lib/insights";
import { analisarFinancas } from "@/lib/analise";
import HeroNarrativo, { type StatHero } from "@/components/dashboard/hero-narrativo";
import DonutCategorias from "@/components/dashboard/donut-categorias";
import TopDespesas from "@/components/dashboard/top-despesas";
import SeletorMes from "@/components/dashboard/seletor-mes";
import HistoricoMensal from "@/components/dashboard/historico-mensal";
import CarteiraCaixa, { type ContaAPagar } from "@/components/dashboard/carteira-caixa";
import CartaoObservacao from "@/components/analise/cartao-observacao";
import SemearCategorias from "@/components/semear-categorias";
import LetreiroBcb from "@/components/dashboard/letreiro-bcb";
import AplicadorRecorrencias from "@/components/dashboard/aplicador-recorrencias";

// Base temporal do dashboard = data_compra (visão caixa "quanto gastei no
// mês"). Fuso de negócio São Paulo (CLAUDE.md).
function mesCorrenteSaoPaulo(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" })
    .format(new Date())
    .slice(0, 7);
}
function hojeSaoPaulo(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
}
function ehMesValido(m: unknown): m is string {
  return typeof m === "string" && /^\d{4}-\d{2}$/.test(m);
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

// Nº de barras no histórico mensal.
const MESES_HISTORICO = 6;

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
  const mesCorrente = mesCorrenteSaoPaulo();
  const mesComDados = ultimaTx?.data_compra?.slice(0, 7) ?? null;
  // Prioridade: query string válida > mês mais recente com dados > mês atual.
  const mes = ehMesValido(sp.mes) ? sp.mes : (mesComDados ?? mesCorrente);
  const anterior = deslocarMes(mes, -1);

  // Janela do histórico (MESES_HISTORICO até o mês selecionado) já cobre o
  // comparativo do herói e a análise. gastoPorCategoria/resumoDoMes filtram
  // por mês, então o histórico extra não contamina donut/KPIs.
  const inicioJanela = `${deslocarMes(mes, -(MESES_HISTORICO - 1))}-01`;
  const [{ data, error }, categoriasCount, carteiraRes, contasRes] = await Promise.all([
    supabase
      .from("transacoes_origem")
      .select(
        "descricao, valor_total, tipo, data_compra, categorias(id, nome, cor, orcamento_mensal)"
      )
      .gte("data_compra", inicioJanela)
      .lt("data_compra", `${deslocarMes(mes, 1)}-01`)
      .order("data_compra", { ascending: false }),
    supabase.from("categorias").select("id", { count: "exact", head: true }),
    // Carteira (regime de caixa): uma linha só. Contas a pagar = faturas de
    // cartão não pagas ∪ boletos pendentes, unificadas por vencimento.
    supabase.from("vw_carteira").select("*").maybeSingle(),
    supabase
      .from("vw_contas_a_pagar")
      .select("tipo, origem_id, transacao_id, descricao, competencia, data_vencimento, status, valor")
      .order("data_vencimento", { ascending: true })
      .limit(8),
  ]);

  if (error) {
    return (
      <p className="text-sm" style={{ color: "var(--telha)" }}>
        Falha ao carregar o dashboard: {error.message}
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

  const resumoAtual = resumoDoMes(transacoes, mes);
  const resumoAnterior = resumoDoMes(transacoes, anterior);
  const categorias = gastoPorCategoria(transacoes, mes);
  const despesas = topDespesas(transacoes, mes, 5);

  const mesesHistorico = Array.from({ length: MESES_HISTORICO }, (_, i) =>
    deslocarMes(mes, -(MESES_HISTORICO - 1) + i)
  );
  const historico = historicoMensal(transacoes, mesesHistorico);

  const frase = montarFraseHeroi({
    mesISO: mes,
    gastoMes: resumoAtual.saidas,
    gastoMesAnterior: resumoAnterior.saidas,
    categorias,
    formatar: formatarCentavos,
  });

  // Projeção só faz sentido para o mês corrente (que ainda está correndo).
  // Meses passados já fecharam: mostra o realizado.
  const ehMesCorrente = mes === mesCorrente;
  const diaAtual = ehMesCorrente ? Number(hojeSaoPaulo().slice(8, 10)) : 31;
  const diasNoMes = new Date(Number(mes.slice(0, 4)), Number(mes.slice(5, 7)), 0).getDate();
  const projecao = ehMesCorrente
    ? projecaoFechamento(resumoAtual.saidas, diaAtual, diasNoMes)
    : resumoAtual.saidas;
  const poupanca = taxaPoupanca(resumoAtual.entradas, resumoAtual.saidas);

  const destaque = analisarFinancas(transacoes, {
    mesISO: mes,
    hojeISO: hojeSaoPaulo(),
    formatar: formatarCentavos,
    limite: 1,
  })[0];

  const stats: StatHero[] = [
    {
      rotulo: "Saldo do mês",
      valor: `${resumoAtual.saldo >= 0 ? "+" : ""}${formatarCentavos(resumoAtual.saldo)}`,
      cor: resumoAtual.saldo >= 0 ? "var(--verde)" : "var(--telha)",
    },
    { rotulo: "Taxa de poupança", valor: poupanca == null ? "—" : `${poupanca}%` },
    {
      rotulo: ehMesCorrente ? "Projeção de fechamento" : "Total de saídas",
      valor: formatarCentavos(projecao),
    },
    {
      rotulo: "Entrou · saiu",
      valor: `${formatarCentavos(resumoAtual.entradas)} · ${formatarCentavos(resumoAtual.saidas)}`,
    },
  ];

  // Avança só até o mês corrente OU o mês mais recente com dados.
  const tetoNavegacao =
    mesComDados && mesComDados > mesCorrente ? mesComDados : mesCorrente;
  const proximoAtivo = mes < tetoNavegacao;

  return (
    <div className="flex flex-col gap-6">
      <AplicadorRecorrencias />
      {/* Letreiro de pregão: em Suspense para BCB lento/fora do ar não travar
          o dashboard — o resto da página renderiza e a faixa chega depois. */}
      <Suspense fallback={<div className="letreiro letreiro-vazio">Carregando indicadores do Banco Central…</div>}>
        <LetreiroBcb />
      </Suspense>

      {(categoriasCount.count ?? 0) === 0 && <SemearCategorias />}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="serifa text-2xl font-medium">Dashboard</h1>
        <SeletorMes mes={mes} proximoAtivo={proximoAtivo} />
      </div>

      {destaque && destaque.id !== "estavel" && (
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
            saldoCaixa={carteiraRes.data?.saldo_caixa ?? 0}
            entradas={carteiraRes.data?.entradas ?? 0}
            saidasAvista={carteiraRes.data?.saidas_avista ?? 0}
            faturasPagas={carteiraRes.data?.faturas_pagas ?? 0}
            boletosPagos={carteiraRes.data?.boletos_pagos ?? 0}
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
