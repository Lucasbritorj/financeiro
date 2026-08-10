// Assistente de análise — motor determinístico que INTERPRETA gastos e
// ganhos. Não é chat nem LLM: são regras sobre os agregados que já
// calculamos, produzindo observações rankeadas por severidade. Lógica
// pura, testada em tests/unit/analise.test.ts. Valores em centavos.

import type { TransacaoInsight, SegmentoFrase } from "./insights.ts";
import {
  resumoDoMes,
  gastoPorCategoria,
  taxaPoupanca,
  projecaoFechamento,
  variacaoPercentual,
  nomeMes,
} from "./insights.ts";

export type Severidade = "alerta" | "atencao" | "positivo" | "neutro";

export type Observacao = {
  id: string; // slug estável (tipo + chave) para React key
  severidade: Severidade;
  titulo: string;
  segmentos: SegmentoFrase[]; // reusa o estilo Ateliê (ouro/verde/telha)
  metrica?: string; // número destacado opcional, ex "-32%"
  pontuacao: number; // ranking interno; maior = mais relevante
};

// Peso base por severidade; magnitude entra como bônus para ordenar
// alertas mais graves acima de alertas leves.
const PESO: Record<Severidade, number> = {
  alerta: 1000,
  atencao: 500,
  positivo: 250,
  neutro: 100,
};

function obs(
  id: string,
  severidade: Severidade,
  titulo: string,
  segmentos: SegmentoFrase[],
  magnitude = 0,
  metrica?: string
): Observacao {
  return {
    id,
    severidade,
    titulo,
    segmentos,
    metrica,
    pontuacao: PESO[severidade] + Math.min(magnitude, PESO[severidade] - 1),
  };
}

/** Lista de "YYYY-MM" dos n meses anteriores a mesISO (mais recente primeiro). */
export function mesesAnteriores(mesISO: string, n: number): string[] {
  const [ano, mes] = mesISO.split("-").map(Number);
  const saida: string[] = [];
  for (let i = 1; i <= n; i++) {
    const d = new Date(Date.UTC(ano, mes - 1 - i, 1));
    saida.push(d.toISOString().slice(0, 7));
  }
  return saida;
}

function fmtPct(n: number): string {
  return `${n > 0 ? "+" : ""}${n}%`;
}

// Gasto (DESPESA) por categoria e por mês: Map<nomeCategoria, Map<mes, centavos>>.
function despesaCategoriaPorMes(
  transacoes: TransacaoInsight[]
): Map<string, Map<string, number>> {
  const mapa = new Map<string, Map<string, number>>();
  for (const t of transacoes) {
    if (t.tipo !== "DESPESA") continue;
    const nome = t.categoria?.nome ?? "Sem categoria";
    const mes = t.data_compra.slice(0, 7);
    const porMes = mapa.get(nome) ?? new Map<string, number>();
    porMes.set(mes, (porMes.get(mes) ?? 0) + t.valor_total);
    mapa.set(nome, porMes);
  }
  return mapa;
}

function media(valores: number[]): number {
  if (valores.length === 0) return 0;
  return Math.round(valores.reduce((s, v) => s + v, 0) / valores.length);
}

type Ctx = {
  mesISO: string;
  hojeISO: string;
  formatar: (centavos: number) => string;
};

// ---------------------- Detectores (cada um: Observacao[] ) ----------------------

// Taxa de poupança: comparar o mês atual com o anterior (pontos percentuais).
function detTaxaPoupanca(t: TransacaoInsight[], c: Ctx): Observacao[] {
  const anterior = mesesAnteriores(c.mesISO, 1)[0];
  const atual = resumoDoMes(t, c.mesISO);
  const prev = resumoDoMes(t, anterior);
  const taxaAtual = taxaPoupanca(atual.entradas, atual.saidas);
  const taxaPrev = taxaPoupanca(prev.entradas, prev.saidas);
  if (taxaAtual == null || taxaPrev == null) return [];
  const delta = taxaAtual - taxaPrev;
  if (delta <= -8) {
    return [
      obs(
        "poupanca-queda",
        "alerta",
        "Sua taxa de poupança caiu",
        [
          { texto: "Você poupou " },
          { texto: `${taxaAtual}%`, enfase: "telha" },
          { texto: ` da sua renda este mês, contra ` },
          { texto: `${taxaPrev}%`, enfase: "ouro" },
          { texto: ` no mês anterior.` },
        ],
        Math.abs(delta) * 10,
        `${delta}pp`
      ),
    ];
  }
  if (delta >= 8) {
    return [
      obs(
        "poupanca-alta",
        "positivo",
        "Você está poupando mais",
        [
          { texto: "Sua taxa de poupança subiu de " },
          { texto: `${taxaPrev}%`, enfase: "ouro" },
          { texto: " para " },
          { texto: `${taxaAtual}%`, enfase: "verde" },
          { texto: "." },
        ],
        Math.abs(delta) * 10,
        fmtPct(delta)
      ),
    ];
  }
  return [];
}

// Categoria em alta: gasto do mês bem acima da média dos até 3 meses
// anteriores (com dado). >=2x = alerta; >=1,4x = atenção.
function detCategoriasEmAlta(t: TransacaoInsight[], c: Ctx): Observacao[] {
  const porCat = despesaCategoriaPorMes(t);
  const anteriores = mesesAnteriores(c.mesISO, 3);
  const saida: Observacao[] = [];
  for (const [nome, porMes] of porCat) {
    const atual = porMes.get(c.mesISO) ?? 0;
    if (atual <= 0) continue;
    const historico = anteriores
      .map((m) => porMes.get(m))
      .filter((v): v is number => v != null && v > 0);
    if (historico.length === 0) continue;
    const med = media(historico);
    if (med <= 0) continue;
    const razao = atual / med;
    if (razao < 1.4) continue;
    const pct = variacaoPercentual(atual, med) ?? 0;
    const grave = razao >= 2;
    saida.push(
      obs(
        `alta-${nome}`,
        grave ? "alerta" : "atencao",
        `${nome} acima do normal`,
        [
          { texto: `Você gastou ` },
          { texto: c.formatar(atual), enfase: grave ? "telha" : "ouro" },
          { texto: ` em ${nome} este mês — ` },
          { texto: fmtPct(pct), enfase: "telha" },
          { texto: ` sobre a média de ${c.formatar(med)} dos meses anteriores.` },
        ],
        (razao - 1) * 100,
        fmtPct(pct)
      )
    );
  }
  return saida;
}

// Envelopes (orçamento por categoria): estourado = alerta; >=80% = atenção.
function detEnvelopes(t: TransacaoInsight[], c: Ctx): Observacao[] {
  const cats = gastoPorCategoria(t, c.mesISO);
  const saida: Observacao[] = [];
  for (const cat of cats) {
    if (cat.orcamento == null) continue;
    const ratio = cat.gasto / cat.orcamento;
    if (ratio > 1) {
      const excesso = cat.gasto - cat.orcamento;
      saida.push(
        obs(
          `envelope-estouro-${cat.nome}`,
          "alerta",
          `Envelope de ${cat.nome} estourou`,
          [
            { texto: `${cat.nome} passou o orçamento de ` },
            { texto: c.formatar(cat.orcamento), enfase: "ouro" },
            { texto: ` em ` },
            { texto: c.formatar(excesso), enfase: "telha" },
            { texto: `.` },
          ],
          (ratio - 1) * 200,
          fmtPct(variacaoPercentual(cat.gasto, cat.orcamento) ?? 0)
        )
      );
    } else if (ratio >= 0.8) {
      saida.push(
        obs(
          `envelope-quase-${cat.nome}`,
          "atencao",
          `${cat.nome} perto do limite`,
          [
            { texto: `Você já usou ` },
            { texto: `${Math.round(ratio * 100)}%`, enfase: "ouro" },
            { texto: ` do orçamento de ${cat.nome} (` },
            { texto: c.formatar(cat.gasto), enfase: "ouro" },
            { texto: ` de ${c.formatar(cat.orcamento)}).` },
          ],
          ratio * 100
        )
      );
    }
  }
  return saida;
}

// Concentração: maior categoria passa de 40% do gasto total do mês.
function detConcentracao(t: TransacaoInsight[], c: Ctx): Observacao[] {
  const cats = gastoPorCategoria(t, c.mesISO);
  const total = cats.reduce((s, cat) => s + cat.gasto, 0);
  if (total <= 0 || cats.length < 2) return [];
  const maior = cats[0];
  const fracao = maior.gasto / total;
  if (fracao < 0.4) return [];
  return [
    obs(
      "concentracao",
      "atencao",
      "Gastos concentrados",
      [
        { texto: `${maior.nome} representa ` },
        { texto: `${Math.round(fracao * 100)}%`, enfase: "ouro" },
        { texto: ` de tudo que você gastou este mês.` },
      ],
      fracao * 100
    ),
  ];
}

// Projeção: no ritmo até hoje, o mês fecha gastando mais do que entrou.
function detProjecaoVermelho(t: TransacaoInsight[], c: Ctx): Observacao[] {
  const { entradas, saidas } = resumoDoMes(t, c.mesISO);
  if (entradas <= 0 || saidas <= 0) return [];
  const dia = Number(c.hojeISO.slice(8, 10));
  const diasNoMes = new Date(
    Number(c.mesISO.slice(0, 4)),
    Number(c.mesISO.slice(5, 7)),
    0
  ).getDate();
  const projecao = projecaoFechamento(saidas, dia, diasNoMes);
  if (projecao <= entradas) return [];
  return [
    obs(
      "projecao-vermelho",
      "alerta",
      "O mês pode fechar no vermelho",
      [
        { texto: `No ritmo atual, você fecha ${nomeMes(c.mesISO)} gastando ` },
        { texto: c.formatar(projecao), enfase: "telha" },
        { texto: ` — acima dos ` },
        { texto: c.formatar(entradas), enfase: "ouro" },
        { texto: ` que entraram.` },
      ],
      ((projecao - entradas) / entradas) * 200
    ),
  ];
}

// Recorrentes: mesma (descrição normalizada + valor) em >=3 meses distintos
// => provável assinatura/conta fixa. Soma o comprometimento mensal.
function detRecorrentes(t: TransacaoInsight[], c: Ctx): Observacao[] {
  const grupos = new Map<string, Set<string>>();
  const valorDe = new Map<string, number>();
  const nomeDe = new Map<string, string>();
  for (const tx of t) {
    if (tx.tipo !== "DESPESA") continue;
    const chave = `${tx.descricao.trim().toLowerCase()}|${tx.valor_total}`;
    const meses = grupos.get(chave) ?? new Set<string>();
    meses.add(tx.data_compra.slice(0, 7));
    grupos.set(chave, meses);
    valorDe.set(chave, tx.valor_total);
    nomeDe.set(chave, tx.descricao.trim());
  }
  let totalMensal = 0;
  const nomes: string[] = [];
  for (const [chave, meses] of grupos) {
    if (meses.size >= 3) {
      totalMensal += valorDe.get(chave) ?? 0;
      nomes.push(nomeDe.get(chave) ?? "");
    }
  }
  if (nomes.length === 0) return [];
  return [
    obs(
      "recorrentes",
      "neutro",
      "Gastos recorrentes identificados",
      [
        { texto: `Você tem cerca de ` },
        { texto: `${c.formatar(totalMensal)}/mês`, enfase: "ouro" },
        {
          texto: ` comprometidos em ${nomes.length} gasto${nomes.length > 1 ? "s" : ""} recorrente${nomes.length > 1 ? "s" : ""} (${nomes.slice(0, 3).join(", ")}${nomes.length > 3 ? "…" : ""}).`,
        },
      ],
      nomes.length * 10
    ),
  ];
}

// Categoria adormecida: tinha gasto em todos os 3 meses anteriores e zerou
// no mês atual — um corte que vale reconhecer.
function detCategoriaAdormecida(t: TransacaoInsight[], c: Ctx): Observacao[] {
  const porCat = despesaCategoriaPorMes(t);
  const anteriores = mesesAnteriores(c.mesISO, 3);
  const saida: Observacao[] = [];
  for (const [nome, porMes] of porCat) {
    const atual = porMes.get(c.mesISO) ?? 0;
    if (atual > 0) continue;
    const historico = anteriores
      .map((m) => porMes.get(m))
      .filter((v): v is number => v != null && v > 0);
    if (historico.length < anteriores.length) continue; // gastou em TODOS
    const med = media(historico);
    saida.push(
      obs(
        `adormecida-${nome}`,
        "positivo",
        `Sem gastos em ${nome}`,
        [
          { texto: `Você não gastou nada em ${nome} este mês — a média era ` },
          { texto: `${c.formatar(med)}/mês`, enfase: "verde" },
          { texto: `.` },
        ],
        med / 100
      )
    );
  }
  return saida;
}

// Ganhos: variação da renda mês a mês, quando relevante.
function detGanhos(t: TransacaoInsight[], c: Ctx): Observacao[] {
  const anterior = mesesAnteriores(c.mesISO, 1)[0];
  const atual = resumoDoMes(t, c.mesISO).entradas;
  const prev = resumoDoMes(t, anterior).entradas;
  const delta = variacaoPercentual(atual, prev);
  if (delta == null || Math.abs(delta) < 15) return [];
  const caiu = delta < 0;
  return [
    obs(
      "ganhos",
      caiu ? "atencao" : "positivo",
      caiu ? "Sua renda caiu este mês" : "Sua renda subiu este mês",
      [
        { texto: `As entradas ${caiu ? "caíram" : "subiram"} ` },
        { texto: fmtPct(delta), enfase: caiu ? "telha" : "verde" },
        { texto: ` sobre o mês anterior (` },
        { texto: c.formatar(atual), enfase: "ouro" },
        { texto: `).` },
      ],
      Math.abs(delta)
    ),
  ];
}

/**
 * Roda todos os detectores, ordena por relevância e devolve os melhores.
 * Se nada de notável, devolve uma leitura neutra amigável (nunca vazio
 * quando há dados; array vazio só quando não há transações no mês).
 */
export function analisarFinancas(
  transacoes: TransacaoInsight[],
  args: { mesISO: string; hojeISO: string; formatar: (c: number) => string; limite?: number }
): Observacao[] {
  const ctx: Ctx = {
    mesISO: args.mesISO,
    hojeISO: args.hojeISO,
    formatar: args.formatar,
  };
  const detectores = [
    detProjecaoVermelho,
    detEnvelopes,
    detCategoriasEmAlta,
    detTaxaPoupanca,
    detConcentracao,
    detGanhos,
    detRecorrentes,
    detCategoriaAdormecida,
  ];
  const todas = detectores.flatMap((d) => d(transacoes, ctx));
  todas.sort((a, b) => b.pontuacao - a.pontuacao);

  const doMes = resumoDoMes(transacoes, args.mesISO);
  if (todas.length === 0) {
    if (doMes.saidas === 0 && doMes.entradas === 0) return [];
    return [
      obs("estavel", "neutro", "Mês sob controle", [
        { texto: "Nada fora do padrão este mês — seus gastos seguem o ritmo dos meses anteriores." },
      ]),
    ];
  }
  return todas.slice(0, args.limite ?? 6);
}
