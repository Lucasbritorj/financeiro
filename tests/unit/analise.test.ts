import { test } from "node:test";
import assert from "node:assert/strict";
import { analisarFinancas, mesesAnteriores } from "../../src/lib/analise.ts";
import type { TransacaoInsight } from "../../src/lib/insights.ts";

const fmt = (c: number) => `R$ ${(c / 100).toFixed(0)}`;
const HOJE = "2026-07-23";
const MES = "2026-07";

function tx(
  valor: number,
  tipo: "DESPESA" | "RECEITA",
  data: string,
  categoria: TransacaoInsight["categoria"] = null,
  descricao = "x"
): TransacaoInsight {
  return { descricao, valor_total: valor, tipo, data_compra: data, categoria };
}

const cat = (nome: string, orcamento: number | null = null) => ({
  id: nome,
  nome,
  cor: null,
  orcamento_mensal: orcamento,
});

function porId(obs: ReturnType<typeof analisarFinancas>, id: string) {
  return obs.find((o) => o.id === id);
}

test("mesesAnteriores lista n meses, mais recente primeiro, cruzando ano", () => {
  assert.deepEqual(mesesAnteriores("2026-07", 3), ["2026-06", "2026-05", "2026-04"]);
  assert.deepEqual(mesesAnteriores("2026-01", 2), ["2025-12", "2025-11"]);
});

test("mês vazio => nenhuma observação", () => {
  assert.deepEqual(analisarFinancas([], { mesISO: MES, hojeISO: HOJE, formatar: fmt }), []);
});

test("envelope estourado vira alerta com métrica", () => {
  const t = [tx(41000, "DESPESA", "2026-07-05", cat("Delivery", 35000))];
  const o = analisarFinancas(t, { mesISO: MES, hojeISO: HOJE, formatar: fmt });
  const est = porId(o, "envelope-estouro-Delivery");
  assert.ok(est, "esperava observação de envelope estourado");
  assert.equal(est.severidade, "alerta");
  assert.match(est.segmentos.map((s) => s.texto).join(""), /passou o orçamento/);
});

test("envelope entre 80% e 100% vira atenção", () => {
  const t = [tx(30000, "DESPESA", "2026-07-05", cat("Mercado", 35000))];
  const o = analisarFinancas(t, { mesISO: MES, hojeISO: HOJE, formatar: fmt });
  const quase = porId(o, "envelope-quase-Mercado");
  assert.ok(quase);
  assert.equal(quase.severidade, "atencao");
});

test("categoria em alta: 2x a média => alerta", () => {
  const t = [
    tx(60000, "DESPESA", "2026-07-10", cat("Delivery"), "ifood"),
    tx(20000, "DESPESA", "2026-06-10", cat("Delivery"), "ifood"),
    tx(20000, "DESPESA", "2026-05-10", cat("Delivery"), "ifood"),
    tx(20000, "DESPESA", "2026-04-10", cat("Delivery"), "ifood"),
  ];
  const o = analisarFinancas(t, { mesISO: MES, hojeISO: HOJE, formatar: fmt });
  const alta = porId(o, "alta-Delivery");
  assert.ok(alta, "esperava observação de categoria em alta");
  assert.equal(alta.severidade, "alerta"); // 60000 / 20000 = 3x
  assert.equal(alta.metrica, "+200%");
});

test("taxa de poupança em queda vira alerta", () => {
  const t = [
    // julho: entra 1000, gasta 900 => poupança 10%
    tx(100000, "RECEITA", "2026-07-01"),
    tx(90000, "DESPESA", "2026-07-05"),
    // junho: entra 1000, gasta 600 => poupança 40%
    tx(100000, "RECEITA", "2026-06-01"),
    tx(60000, "DESPESA", "2026-06-05"),
  ];
  const o = analisarFinancas(t, { mesISO: MES, hojeISO: HOJE, formatar: fmt });
  const p = porId(o, "poupanca-queda");
  assert.ok(p, "esperava alerta de poupança em queda");
  assert.equal(p.severidade, "alerta");
});

test("concentração: uma categoria acima de 40% do total", () => {
  const t = [
    tx(80000, "DESPESA", "2026-07-05", cat("Moradia")),
    tx(10000, "DESPESA", "2026-07-06", cat("Mercado")),
    tx(10000, "DESPESA", "2026-07-07", cat("Lazer")),
  ];
  const o = analisarFinancas(t, { mesISO: MES, hojeISO: HOJE, formatar: fmt });
  const conc = porId(o, "concentracao");
  assert.ok(conc);
  assert.match(conc.segmentos.map((s) => s.texto).join(""), /80%/);
});

test("projeção de fechamento no vermelho", () => {
  // dia 23/31: gastou 800 (ritmo ~1077 no fim), entrou 1000 => projeção > entradas
  const t = [
    tx(100000, "RECEITA", "2026-07-01"),
    tx(80000, "DESPESA", "2026-07-10"),
  ];
  const o = analisarFinancas(t, { mesISO: MES, hojeISO: HOJE, formatar: fmt });
  assert.ok(porId(o, "projecao-vermelho"), "esperava alerta de projeção no vermelho");
});

test("recorrentes: mesma descrição+valor em 3 meses", () => {
  const t = [
    tx(5000, "DESPESA", "2026-07-05", cat("Assinaturas"), "NETFLIX"),
    tx(5000, "DESPESA", "2026-06-05", cat("Assinaturas"), "NETFLIX"),
    tx(5000, "DESPESA", "2026-05-05", cat("Assinaturas"), "NETFLIX"),
  ];
  const o = analisarFinancas(t, { mesISO: MES, hojeISO: HOJE, formatar: fmt });
  const rec = porId(o, "recorrentes");
  assert.ok(rec);
  assert.match(rec.segmentos.map((s) => s.texto).join(""), /NETFLIX/);
});

test("categoria adormecida: gastava sempre e zerou", () => {
  const t = [
    tx(20000, "DESPESA", "2026-06-10", cat("Lazer"), "cinema"),
    tx(20000, "DESPESA", "2026-05-10", cat("Lazer"), "cinema"),
    tx(20000, "DESPESA", "2026-04-10", cat("Lazer"), "cinema"),
    // nada de Lazer em julho; um gasto qualquer p/ o mês não ficar vazio
    tx(10000, "DESPESA", "2026-07-10", cat("Mercado"), "mercado"),
  ];
  const o = analisarFinancas(t, { mesISO: MES, hojeISO: HOJE, formatar: fmt });
  const ad = porId(o, "adormecida-Lazer");
  assert.ok(ad, "esperava observação de categoria adormecida");
  assert.equal(ad.severidade, "positivo");
});

test("mês com movimento mas nada notável => leitura neutra", () => {
  const t = [tx(10000, "DESPESA", "2026-07-10", cat("Mercado"), "compra única")];
  const o = analisarFinancas(t, { mesISO: MES, hojeISO: HOJE, formatar: fmt });
  assert.equal(o.length, 1);
  assert.equal(o[0].id, "estavel");
});

test("alerta ranqueia acima de positivo", () => {
  const t = [
    tx(41000, "DESPESA", "2026-07-05", cat("Delivery", 35000)), // alerta envelope
    tx(20000, "DESPESA", "2026-06-10", cat("Lazer"), "cinema"),
    tx(20000, "DESPESA", "2026-05-10", cat("Lazer"), "cinema"),
    tx(20000, "DESPESA", "2026-04-10", cat("Lazer"), "cinema"), // adormecida (positivo)
  ];
  const o = analisarFinancas(t, { mesISO: MES, hojeISO: HOJE, formatar: fmt });
  assert.equal(o[0].severidade, "alerta");
});

// --- Caracterização: detGanhos era o único detector sem teste, e o refactor
// mexe em todas as chamadas de obs(). Escritos contra o comportamento vigente.

test("ganhos: renda subindo acima de 15% vira observação positiva", () => {
  const o = porId(
    analisarFinancas(
      [
        tx(100000, "RECEITA", "2026-06-05"),
        tx(150000, "RECEITA", "2026-07-05"),
        tx(1000, "DESPESA", "2026-07-06"),
      ],
      { mesISO: MES, hojeISO: HOJE, formatar: fmt },
    ),
    "ganhos",
  );
  assert.ok(o, "esperava observação 'ganhos'");
  assert.equal(o.severidade, "positivo");
  assert.match(o.titulo, /subiu/);
});

test("ganhos: renda caindo acima de 15% vira atenção", () => {
  const o = porId(
    analisarFinancas(
      [
        tx(200000, "RECEITA", "2026-06-05"),
        tx(100000, "RECEITA", "2026-07-05"),
        tx(1000, "DESPESA", "2026-07-06"),
      ],
      { mesISO: MES, hojeISO: HOJE, formatar: fmt },
    ),
    "ganhos",
  );
  assert.ok(o, "esperava observação 'ganhos'");
  assert.equal(o.severidade, "atencao");
  assert.match(o.titulo, /caiu/);
});

test("ganhos: variação abaixo de 15% não gera observação", () => {
  const o = porId(
    analisarFinancas(
      [
        tx(100000, "RECEITA", "2026-06-05"),
        tx(110000, "RECEITA", "2026-07-05"),
        tx(1000, "DESPESA", "2026-07-06"),
      ],
      { mesISO: MES, hojeISO: HOJE, formatar: fmt },
    ),
    "ganhos",
  );
  assert.equal(o, undefined);
});

test("obs: pontuação é o peso da severidade mais a magnitude, com teto", () => {
  // A magnitude nunca pode empurrar uma severidade para a faixa da seguinte:
  // um 'positivo' com magnitude enorme continua abaixo de qualquer 'atencao'.
  const observacoes = analisarFinancas(
    [
      tx(10000, "RECEITA", "2026-06-05"),
      tx(9000000, "RECEITA", "2026-07-05"), // variação absurda
      tx(1000, "DESPESA", "2026-07-06"),
    ],
    { mesISO: MES, hojeISO: HOJE, formatar: fmt },
  );
  const ganhos = porId(observacoes, "ganhos");
  assert.ok(ganhos);
  assert.equal(ganhos.severidade, "positivo");
  assert.ok(ganhos.pontuacao < 500, `positivo deve ficar abaixo de atencao, veio ${ganhos.pontuacao}`);
  assert.ok(ganhos.pontuacao >= 250, `e não abaixo do próprio piso, veio ${ganhos.pontuacao}`);
});
