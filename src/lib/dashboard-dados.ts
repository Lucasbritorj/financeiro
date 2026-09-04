// Lógica pura do dashboard — extraída de app/(protegido)/dashboard/page.tsx
// para poder ser testada sem renderizar componente nem subir Supabase, mesmo
// raciocínio de importacao-preview.ts.
//
// Nada aqui faz I/O: a página busca as linhas e passa para cá. Base temporal
// é data_compra (visão caixa "quanto gastei no mês"), fuso de negócio
// America/Sao_Paulo (CLAUDE.md).

import { formatarCentavos } from "./money.ts";
import { analisarFinancas } from "./analise.ts";
import {
  deslocarMes,
  gastoPorCategoria,
  historicoMensal,
  montarFraseHeroi,
  projecaoFechamento,
  resumoDoMes,
  taxaPoupanca,
  topDespesas,
  type TransacaoInsight,
} from "./insights.ts";

/** Nº de barras no histórico mensal. */
export const MESES_HISTORICO = 6;

export type StatDashboard = { rotulo: string; valor: string; cor?: string };

/** Uma linha como o select de transacoes_origem devolve. */
export type LinhaTransacao = {
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

export function ehMesValido(m: unknown): m is string {
  return typeof m === "string" && /^\d{4}-\d{2}$/.test(m);
}

/** Mês corrente (yyyy-mm) no fuso de negócio, não no do servidor. */
export function mesCorrenteSaoPaulo(agora: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" })
    .format(agora)
    .slice(0, 7);
}

export type JanelaMes = {
  mes: string;
  anterior: string;
  /** Primeiro dia da janela do histórico, para o filtro da query. */
  inicioJanela: string;
  /** Primeiro dia do mês seguinte — limite exclusivo da query. */
  fimJanela: string;
  ehMesCorrente: boolean;
  /** Até onde o seletor pode avançar. */
  proximoAtivo: boolean;
};

/**
 * Prioridade do mês exibido: query string válida > mês mais recente com dados
 * > mês atual. Nunca cai num mês vazio por acaso.
 *
 * A navegação avança só até o mês corrente OU o mês mais recente com dados —
 * o que for maior, para um lançamento futuro continuar alcançável.
 */
export function resolverJanela(args: {
  mesQuery: unknown;
  mesComDados: string | null;
  mesCorrente: string;
}): JanelaMes {
  const { mesQuery, mesComDados, mesCorrente } = args;
  const mes = ehMesValido(mesQuery) ? mesQuery : (mesComDados ?? mesCorrente);
  const teto = mesComDados && mesComDados > mesCorrente ? mesComDados : mesCorrente;
  return {
    mes,
    anterior: deslocarMes(mes, -1),
    inicioJanela: `${deslocarMes(mes, -(MESES_HISTORICO - 1))}-01`,
    fimJanela: `${deslocarMes(mes, 1)}-01`,
    ehMesCorrente: mes === mesCorrente,
    proximoAtivo: mes < teto,
  };
}

/**
 * Descarta linha cujo `tipo` não é DESPESA nem RECEITA — o resto do dashboard
 * assume esse par fechado.
 */
export function normalizarTransacoes(linhas: LinhaTransacao[]): TransacaoInsight[] {
  return linhas.flatMap((t) => {
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
}

/** Dias do mês de um yyyy-mm — dia 0 do mês seguinte. */
export function diasNoMes(mesISO: string): number {
  return new Date(Number(mesISO.slice(0, 4)), Number(mesISO.slice(5, 7)), 0).getDate();
}

/**
 * Projeção só faz sentido para o mês corrente, que ainda está correndo. Mês
 * passado já fechou: o realizado é o próprio total.
 */
export function projetarSaidas(args: {
  saidas: number;
  mes: string;
  ehMesCorrente: boolean;
  hojeISO: string;
}): number {
  if (!args.ehMesCorrente) return args.saidas;
  const diaAtual = Number(args.hojeISO.slice(8, 10));
  return projecaoFechamento(args.saidas, diaAtual, diasNoMes(args.mes));
}

export function montarStats(args: {
  resumo: { saldo: number; entradas: number; saidas: number };
  poupanca: number | null;
  projecao: number;
  ehMesCorrente: boolean;
}): StatDashboard[] {
  const { resumo, poupanca, projecao, ehMesCorrente } = args;
  const positivo = resumo.saldo >= 0;
  return [
    {
      rotulo: "Saldo do mês",
      valor: `${positivo ? "+" : ""}${formatarCentavos(resumo.saldo)}`,
      cor: positivo ? "var(--verde)" : "var(--telha)",
    },
    { rotulo: "Taxa de poupança", valor: poupanca == null ? "—" : `${poupanca}%` },
    {
      rotulo: ehMesCorrente ? "Projeção de fechamento" : "Total de saídas",
      valor: formatarCentavos(projecao),
    },
    {
      rotulo: "Entrou · saiu",
      valor: `${formatarCentavos(resumo.entradas)} · ${formatarCentavos(resumo.saidas)}`,
    },
  ];
}

/** Os totais da carteira com os defaults aplicados — a view pode vir vazia. */
export type Carteira = {
  saldoCaixa: number;
  entradas: number;
  saidasAvista: number;
  faturasPagas: number;
  boletosPagos: number;
};

export function montarCarteira(
  linha: Partial<Record<keyof CarteiraBruta, number | null>> | null | undefined,
): Carteira {
  return {
    saldoCaixa: linha?.saldo_caixa ?? 0,
    entradas: linha?.entradas ?? 0,
    saidasAvista: linha?.saidas_avista ?? 0,
    faturasPagas: linha?.faturas_pagas ?? 0,
    boletosPagos: linha?.boletos_pagos ?? 0,
  };
}

type CarteiraBruta = {
  saldo_caixa: number;
  entradas: number;
  saidas_avista: number;
  faturas_pagas: number;
  boletos_pagos: number;
};

/** Tudo que o JSX do dashboard precisa, já calculado. */
export function montarPainel(args: {
  transacoes: TransacaoInsight[];
  janela: JanelaMes;
  hojeISO: string;
}) {
  const { transacoes, janela, hojeISO } = args;
  const { mes } = janela;

  const resumoAtual = resumoDoMes(transacoes, mes);
  const resumoAnterior = resumoDoMes(transacoes, janela.anterior);
  const categorias = gastoPorCategoria(transacoes, mes);
  const despesas = topDespesas(transacoes, mes, 5);

  const mesesHistorico = Array.from({ length: MESES_HISTORICO }, (_, i) =>
    deslocarMes(mes, -(MESES_HISTORICO - 1) + i),
  );

  const projecao = projetarSaidas({
    saidas: resumoAtual.saidas,
    mes,
    ehMesCorrente: janela.ehMesCorrente,
    hojeISO,
  });

  return {
    categorias,
    despesas,
    historico: historicoMensal(transacoes, mesesHistorico),
    frase: montarFraseHeroi({
      mesISO: mes,
      gastoMes: resumoAtual.saidas,
      gastoMesAnterior: resumoAnterior.saidas,
      categorias,
      formatar: formatarCentavos,
    }),
    stats: montarStats({
      resumo: resumoAtual,
      poupanca: taxaPoupanca(resumoAtual.entradas, resumoAtual.saidas),
      projecao,
      ehMesCorrente: janela.ehMesCorrente,
    }),
    destaque: analisarFinancas(transacoes, {
      mesISO: mes,
      hojeISO,
      formatar: formatarCentavos,
      limite: 1,
    })[0],
  };
}
