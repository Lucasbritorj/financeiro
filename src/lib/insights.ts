// Insights determinísticos do assistente — lógica pura, testada em
// tests/unit/insights.test.ts. Sem LLM: template + agregação resolvem
// o herói narrativo de graça e na hora (modelo §2/§4-B).
// Base temporal: data_compra (visão caixa "quanto gastei no mês");
// a visão por competência de fatura continua em fluxo.ts.
// Valores em centavos (convenção do projeto).

export type TransacaoInsight = {
  descricao: string;
  valor_total: number;
  tipo: "DESPESA" | "RECEITA";
  data_compra: string; // ISO "YYYY-MM-DD"
  /**
   * 0023. LIQUIDACAO_FATURA = pagamento de fatura de cartão: saída de caixa
   * que quita consumo JÁ contado nas parcelas. Não pode somar de novo aqui,
   * senão a compra conta no mês da compra e o pagamento no mês do pagamento.
   * Opcional no tipo para não quebrar chamador antigo — ausente = CONSUMO.
   */
  natureza?: "CONSUMO" | "LIQUIDACAO_FATURA" | null;
  categoria: {
    id: string;
    nome: string;
    cor: string | null;
    orcamento_mensal: number | null;
  } | null;
};

export type GastoCategoria = {
  id: string | null; // null = sem categoria
  nome: string;
  cor: string | null;
  gasto: number;
  orcamento: number | null;
};

export type SegmentoFrase = {
  texto: string;
  enfase?: "ouro" | "verde" | "telha";
};

const NOMES_MES = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];

/** "2026-07" -> "julho" */
export function nomeMes(mesISO: string): string {
  return NOMES_MES[Number(mesISO.slice(5, 7)) - 1] ?? mesISO;
}

/** "2026-07" + delta meses -> "YYYY-MM" (delta pode ser negativo). */
export function deslocarMes(mesISO: string, delta: number): string {
  const [ano, mes] = mesISO.split("-").map(Number);
  return new Date(Date.UTC(ano, mes - 1 + delta, 1)).toISOString().slice(0, 7);
}

/** Resumo (entradas/saídas/saldo) de cada mês pedido, na ordem dada. */
export function historicoMensal(
  transacoes: TransacaoInsight[],
  meses: string[]
): { mes: string; entradas: number; saidas: number; saldo: number }[] {
  return meses.map((mes) => ({ mes, ...resumoDoMes(transacoes, mes) }));
}

/** Competência (YYYY-MM) mais recente presente nas transações; null se vazio. */
export function ultimoMesComDados(transacoes: TransacaoInsight[]): string | null {
  let max: string | null = null;
  for (const t of transacoes) {
    const m = t.data_compra.slice(0, 7);
    if (max === null || m > max) max = m;
  }
  return max;
}

/**
 * Liquidação de fatura não é consumo: é a quitação de consumo já somado nas
 * compras do cartão. Contar aqui dobraria o valor, em meses diferentes.
 * `natureza` ausente ou null = CONSUMO (dado anterior à 0023).
 */
function ehConsumo(t: TransacaoInsight): boolean {
  return (t.natureza ?? "CONSUMO") === "CONSUMO";
}

function doMes(transacoes: TransacaoInsight[], mesISO: string) {
  return transacoes.filter(
    (t) => t.data_compra.slice(0, 7) === mesISO && ehConsumo(t),
  );
}

export function resumoDoMes(transacoes: TransacaoInsight[], mesISO: string) {
  let entradas = 0;
  let saidas = 0;
  for (const t of doMes(transacoes, mesISO)) {
    if (t.tipo === "RECEITA") entradas += t.valor_total;
    else saidas += t.valor_total;
  }
  return { entradas, saidas, saldo: entradas - saidas };
}

/** Despesas do mês agrupadas por categoria, maiores primeiro. */
export function gastoPorCategoria(
  transacoes: TransacaoInsight[],
  mesISO: string
): GastoCategoria[] {
  const grupos = new Map<string | null, GastoCategoria>();
  for (const t of doMes(transacoes, mesISO)) {
    if (t.tipo !== "DESPESA") continue;
    const chave = t.categoria?.id ?? null;
    const atual = grupos.get(chave) ?? {
      id: chave,
      nome: t.categoria?.nome ?? "Sem categoria",
      cor: t.categoria?.cor ?? null,
      gasto: 0,
      orcamento: t.categoria?.orcamento_mensal ?? null,
    };
    atual.gasto += t.valor_total;
    grupos.set(chave, atual);
  }
  return [...grupos.values()].sort((a, b) => b.gasto - a.gasto);
}

/** Variação % de atual sobre anterior; null quando não há base de comparação. */
export function variacaoPercentual(atual: number, anterior: number): number | null {
  if (anterior <= 0) return null;
  return Math.round(((atual - anterior) / anterior) * 100);
}

/** Projeção linear de fechamento do mês pelo ritmo até hoje. */
export function projecaoFechamento(
  gastoAteHoje: number,
  diaAtual: number,
  diasNoMes: number
): number {
  if (diaAtual <= 0) return gastoAteHoje;
  return Math.round((gastoAteHoje / diaAtual) * diasNoMes);
}

/** (entradas - saídas) / entradas, em %; null sem entradas. */
export function taxaPoupanca(entradas: number, saidas: number): number | null {
  if (entradas <= 0) return null;
  return Math.round(((entradas - saidas) / entradas) * 100);
}

export function topDespesas(
  transacoes: TransacaoInsight[],
  mesISO: string,
  n = 5
): TransacaoInsight[] {
  return doMes(transacoes, mesISO)
    .filter((t) => t.tipo === "DESPESA")
    .sort((a, b) => b.valor_total - a.valor_total)
    .slice(0, n);
}

/** Categorias com envelope estourado (gasto > orçamento definido). */
export function envelopesEstourados(cats: GastoCategoria[]): GastoCategoria[] {
  return cats.filter((c) => c.orcamento != null && c.gasto > c.orcamento);
}

/**
 * O elemento-assinatura: frase que resume o mês, montada por regras.
 * Retorna segmentos para a UI estilizar (ouro = números, telha = estouro,
 * verde = dentro do plano). formatar = formatarCentavos injetado (evita
 * dependência circular e mantém a função pura).
 */
export function montarFraseHeroi(args: {
  mesISO: string;
  gastoMes: number;
  gastoMesAnterior: number;
  categorias: GastoCategoria[];
  formatar: (centavos: number) => string;
}): SegmentoFrase[] {
  const { mesISO, gastoMes, gastoMesAnterior, categorias, formatar } = args;
  const mes = nomeMes(mesISO);

  if (gastoMes === 0) {
    return [
      { texto: `Nenhum gasto lançado em ${mes} ainda — ` },
      { texto: "registre ou importe", enfase: "ouro" },
      { texto: " para ver seu mês aqui." },
    ];
  }

  const partes: SegmentoFrase[] = [
    { texto: "Você já gastou " },
    { texto: formatar(gastoMes), enfase: "ouro" },
    { texto: ` em ${mes}` },
  ];

  const delta = variacaoPercentual(gastoMes, gastoMesAnterior);
  if (delta === null) {
    partes.push({ texto: " — primeiro mês com dados." });
  } else if (delta < 0) {
    partes.push(
      { texto: " — " },
      { texto: `${Math.abs(delta)}% abaixo`, enfase: "verde" },
      { texto: " do mês anterior." }
    );
  } else if (delta > 0) {
    partes.push(
      { texto: " — " },
      { texto: `${delta}% acima`, enfase: "telha" },
      { texto: " do mês anterior." }
    );
  } else {
    partes.push({ texto: " — em linha com o mês anterior." });
  }

  const estouradas = envelopesEstourados(categorias);
  if (estouradas.length > 0) {
    partes.push(
      { texto: " " },
      { texto: estouradas[0].nome, enfase: "telha" },
      { texto: " passou do limite" }
    );
    const noPlano = categorias.find(
      (c) => c.orcamento != null && c.gasto <= c.orcamento
    );
    if (noPlano) {
      partes.push(
        { texto: "; " },
        { texto: noPlano.nome, enfase: "verde" },
        { texto: " está dentro do plano." }
      );
    } else {
      partes.push({ texto: "." });
    }
  } else {
    const comOrcamento = categorias.find((c) => c.orcamento != null);
    if (comOrcamento) {
      partes.push(
        { texto: " Orçamentos " },
        { texto: "dentro do plano", enfase: "verde" },
        { texto: "." }
      );
    } else if (categorias.length > 0) {
      partes.push(
        { texto: " Maior gasto: " },
        { texto: categorias[0].nome, enfase: "ouro" },
        { texto: "." }
      );
    }
  }

  return partes;
}
