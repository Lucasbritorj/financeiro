import { test } from "node:test";
import assert from "node:assert/strict";
import { analisarFinancas, type Severidade } from "../../src/lib/analise.ts";
import type { TransacaoInsight } from "../../src/lib/insights.ts";

const MES = "2026-07";
const categoria = (nome: string, orcamento: number | null = null) => ({
  id: nome, nome, cor: null, orcamento_mensal: orcamento,
});

function tx(
  valor: number,
  tipo: "DESPESA" | "RECEITA" = "DESPESA",
  data = "2026-07-05",
  cat: TransacaoInsight["categoria"] = null,
): TransacaoInsight {
  return { descricao: "limiar", valor_total: valor, tipo, data_compra: data, categoria: cat };
}

function analisar(transacoes: TransacaoInsight[]) {
  return analisarFinancas(transacoes, {
    mesISO: MES,
    hojeISO: "2026-07-31",
    formatar: (centavos) => `${centavos} centavos`,
  });
}

for (const [gasto, id, severidade] of [
  [7999, null, null],
  [8000, "envelope-quase-Mercado", "atencao"],
  [8001, "envelope-quase-Mercado", "atencao"],
  [9999, "envelope-quase-Mercado", "atencao"],
  [10000, "envelope-quase-Mercado", "atencao"],
  [10001, "envelope-estouro-Mercado", "alerta"],
] as const) {
  test(`envelope: ${gasto}/10000 centavos => ${severidade ?? "ausente"}`, () => {
    const envelopes = analisar([tx(gasto, "DESPESA", undefined, categoria("Mercado", 10000))])
      .filter((o) => o.id.startsWith("envelope-"));
    assert.deepEqual(envelopes.map((o) => ({ id: o.id, severidade: o.severidade })),
      id === null ? [] : [{ id, severidade }]);
  });
}

for (const maior of [3999, 4000, 4001]) {
  test(`concentração: maior categoria ${maior}/10000 centavos`, () => {
    // Três categorias permitem que a maior fique abaixo de 40%; total fixo.
    const observacao = analisar([
      tx(maior, "DESPESA", undefined, categoria("Moradia")),
      tx(3000, "DESPESA", undefined, categoria("Mercado")),
      tx(7000 - maior, "DESPESA", undefined, categoria("Lazer")),
    ]).find((o) => o.id === "concentracao");
    if (maior < 4000) assert.equal(observacao, undefined);
    else {
      assert.ok(observacao);
      assert.equal(observacao.severidade, "atencao");
    }
  });
}

// variacaoPercentual arredonda ANTES da comparação com 15. Com base de
// 10000 centavos, 14,49% fica em 14 e 14,99% já vira 15, em ambos os sentidos.
// Na expressão vigente, 1450/10000 * 100 produz 14.499999999999998:
// a borda de 14,5% ainda não gera, em alta nem queda; 1451 centavos já gera.
for (const sentido of [1, -1] as const) {
  for (const [diferenca, gera] of [
    [1449, false],
    [1450, false],
    [1451, true],
    [1499, true],
    [1500, true],
    [1501, true],
  ] as const) {
    test(`ganhos: ${sentido === 1 ? "alta" : "queda"} de ${diferenca}/10000 centavos`, () => {
      const observacao = analisar([
        tx(10000, "RECEITA", "2026-06-05"),
        tx(10000 + sentido * diferenca, "RECEITA"),
      ]).find((o) => o.id === "ganhos");
      if (!gera) assert.equal(observacao, undefined);
      else {
        assert.ok(observacao);
        assert.equal(observacao.severidade, sentido === 1 ? "positivo" : "atencao");
        assert.equal(observacao.pontuacao, (sentido === 1 ? 250 : 500) + 15);
        assert.equal(observacao.segmentos[1].texto, sentido === 1 ? "+15%" : "-15%");
      }
    });
  }
}

const altas: readonly (readonly [number, Severidade | null])[] = [
  [13999, null], [14000, "atencao"], [14001, "atencao"],
  [19999, "atencao"], [20000, "alerta"], [20001, "alerta"],
];
for (const [gasto, severidade] of altas) {
  test(`categoria em alta: ${gasto}/10000 centavos => ${severidade ?? "ausente"}`, () => {
    // Um único mês anterior com dados basta; sua média é exatamente 10000.
    const observacao = analisar([
      tx(10000, "DESPESA", "2026-06-05", categoria("Delivery")),
      tx(gasto, "DESPESA", undefined, categoria("Delivery")),
    ]).find((o) => o.id === "alta-Delivery");
    if (severidade === null) assert.equal(observacao, undefined);
    else {
      assert.ok(observacao);
      assert.equal(observacao.severidade, severidade);
    }
  });
}
