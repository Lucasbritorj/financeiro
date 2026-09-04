// Os detectores do assistente de análise. Cada um tem a mesma assinatura,
// `(transacoes, ctx) => Observacao[]`, e devolve zero ou mais observações; o
// ranking e o corte ficam em analise.ts, que os registra em DETECTORES.
//
// Regras determinísticas sobre agregados — nada de LLM. Valores em centavos.
// Como uma observação é montada e pontuada fica em analise-obs.ts.

import type { TransacaoInsight } from "./insights.ts";
import {
  resumoDoMes,
  gastoPorCategoria,
  taxaPoupanca,
  projecaoFechamento,
  variacaoPercentual,
  nomeMes,
} from "./insights.ts";
import type { Observacao } from "./analise.ts";
import {
  despesaCategoriaPorMes,
  fmtPct,
  media,
  mesesAnteriores,
  obs,
  type Ctx,
  type Detector,
} from "./analise-obs.ts";

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
      obs({
        id: "poupanca-queda",
        severidade: "alerta",
        titulo: "Sua taxa de poupança caiu",
        segmentos: [
          { texto: "Você poupou " },
          { texto: `${taxaAtual}%`, enfase: "telha" },
          { texto: ` da sua renda este mês, contra ` },
          { texto: `${taxaPrev}%`, enfase: "ouro" },
          { texto: ` no mês anterior.` },
        ],
        magnitude: Math.abs(delta) * 10,
        metrica: `${delta}pp`,
      }),
    ];
  }
  if (delta >= 8) {
    return [
      obs({
        id: "poupanca-alta",
        severidade: "positivo",
        titulo: "Você está poupando mais",
        segmentos: [
          { texto: "Sua taxa de poupança subiu de " },
          { texto: `${taxaPrev}%`, enfase: "ouro" },
          { texto: " para " },
          { texto: `${taxaAtual}%`, enfase: "verde" },
          { texto: "." },
        ],
        magnitude: Math.abs(delta) * 10,
        metrica: fmtPct(delta),
      }),
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
      obs({
        id: `alta-${nome}`,
        severidade: grave ? "alerta" : "atencao",
        titulo: `${nome} acima do normal`,
        segmentos: [
          { texto: `Você gastou ` },
          { texto: c.formatar(atual), enfase: grave ? "telha" : "ouro" },
          { texto: ` em ${nome} este mês — ` },
          { texto: fmtPct(pct), enfase: "telha" },
          { texto: ` sobre a média de ${c.formatar(med)} dos meses anteriores.` },
        ],
        magnitude: (razao - 1) * 100,
        metrica: fmtPct(pct),
      }),
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
        obs({
          id: `envelope-estouro-${cat.nome}`,
          severidade: "alerta",
          titulo: `Envelope de ${cat.nome} estourou`,
          segmentos: [
            { texto: `${cat.nome} passou o orçamento de ` },
            { texto: c.formatar(cat.orcamento), enfase: "ouro" },
            { texto: ` em ` },
            { texto: c.formatar(excesso), enfase: "telha" },
            { texto: `.` },
          ],
          magnitude: (ratio - 1) * 200,
          metrica: fmtPct(variacaoPercentual(cat.gasto, cat.orcamento) ?? 0),
        }),
      );
    } else if (ratio >= 0.8) {
      saida.push(
        obs({
          id: `envelope-quase-${cat.nome}`,
          severidade: "atencao",
          titulo: `${cat.nome} perto do limite`,
          segmentos: [
            { texto: `Você já usou ` },
            { texto: `${Math.round(ratio * 100)}%`, enfase: "ouro" },
            { texto: ` do orçamento de ${cat.nome} (` },
            { texto: c.formatar(cat.gasto), enfase: "ouro" },
            { texto: ` de ${c.formatar(cat.orcamento)}).` },
          ],
          magnitude: ratio * 100,
        }),
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
    obs({
      id: "concentracao",
      severidade: "atencao",
      titulo: "Gastos concentrados",
      segmentos: [
        { texto: `${maior.nome} representa ` },
        { texto: `${Math.round(fracao * 100)}%`, enfase: "ouro" },
        { texto: ` de tudo que você gastou este mês.` },
      ],
      magnitude: fracao * 100,
    }),
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
    0,
  ).getDate();
  const projecao = projecaoFechamento(saidas, dia, diasNoMes);
  if (projecao <= entradas) return [];
  return [
    obs({
      id: "projecao-vermelho",
      severidade: "alerta",
      titulo: "O mês pode fechar no vermelho",
      segmentos: [
        { texto: `No ritmo atual, você fecha ${nomeMes(c.mesISO)} gastando ` },
        { texto: c.formatar(projecao), enfase: "telha" },
        { texto: ` — acima dos ` },
        { texto: c.formatar(entradas), enfase: "ouro" },
        { texto: ` que entraram.` },
      ],
      magnitude: ((projecao - entradas) / entradas) * 200,
    }),
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
  const plural = nomes.length > 1 ? "s" : "";
  const amostra = `${nomes.slice(0, 3).join(", ")}${nomes.length > 3 ? "…" : ""}`;
  return [
    obs({
      id: "recorrentes",
      severidade: "neutro",
      titulo: "Gastos recorrentes identificados",
      segmentos: [
        { texto: `Você tem cerca de ` },
        { texto: `${c.formatar(totalMensal)}/mês`, enfase: "ouro" },
        {
          texto: ` comprometidos em ${nomes.length} gasto${plural} recorrente${plural} (${amostra}).`,
        },
      ],
      magnitude: nomes.length * 10,
    }),
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
      obs({
        id: `adormecida-${nome}`,
        severidade: "positivo",
        titulo: `Sem gastos em ${nome}`,
        segmentos: [
          { texto: `Você não gastou nada em ${nome} este mês — a média era ` },
          { texto: `${c.formatar(med)}/mês`, enfase: "verde" },
          { texto: `.` },
        ],
        magnitude: med / 100,
      }),
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
    obs({
      id: "ganhos",
      severidade: caiu ? "atencao" : "positivo",
      titulo: caiu ? "Sua renda caiu este mês" : "Sua renda subiu este mês",
      segmentos: [
        { texto: `As entradas ${caiu ? "caíram" : "subiram"} ` },
        { texto: fmtPct(delta), enfase: caiu ? "telha" : "verde" },
        { texto: ` sobre o mês anterior (` },
        { texto: c.formatar(atual), enfase: "ouro" },
        { texto: `).` },
      ],
      magnitude: Math.abs(delta),
    }),
  ];
}

/** A ordem aqui não define o ranking (isso é a pontuação), só a de execução. */
export const DETECTORES: Detector[] = [
  detProjecaoVermelho,
  detEnvelopes,
  detCategoriasEmAlta,
  detTaxaPoupanca,
  detConcentracao,
  detGanhos,
  detRecorrentes,
  detCategoriaAdormecida,
];
