import { test } from "node:test";
import assert from "node:assert/strict";
import { montarFechamentoMensal } from "../../src/lib/fechamento-mensal.ts";

test("fechamento soma apenas orçamentos definidos e metas ativas", () => {
  const fechamento = montarFechamentoMensal({
    realizado: 80000,
    projecao: 120000,
    categorias: [{ orcamento_mensal: 100000 }, { orcamento_mensal: null }, { orcamento_mensal: 50000 }],
    cofrinhos: [
      { saldo_atual: 25000, valor_alvo: 100000, data_alvo: null },
      { saldo_atual: 10000, valor_alvo: 50000, data_alvo: "2027-01-01" },
    ],
  });
  assert.equal(fechamento.orcamentoTotal, 150000);
  assert.equal(fechamento.diferencaOrcamento, 30000);
  assert.equal(fechamento.quantidadeMetas, 2);
  assert.equal(fechamento.saldoMetas, 35000);
  assert.equal(fechamento.alvoMetas, 150000);
});

test("fechamento sem orçamento não inventa diferença", () => {
  const fechamento = montarFechamentoMensal({
    realizado: 0,
    projecao: 1000,
    categorias: [{ orcamento_mensal: null }],
    cofrinhos: [],
  });
  assert.equal(fechamento.orcamentoTotal, 0);
  assert.equal(fechamento.diferencaOrcamento, null);
  assert.equal(fechamento.quantidadeMetas, 0);
});