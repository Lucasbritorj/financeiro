import { test } from "node:test";
import assert from "node:assert/strict";
import { exportarCsv } from "../../src/lib/exportacao-csv.ts";
test("centavos exatos, aspas, separador, quebra de linha e proteção contra fórmula", () => {
  const csv = exportarCsv([{ id: "1", descricao: '=SUM(1;2)\n"teste"', valor_total: 10001,
    data_compra: "2026-10-16", tipo: "DESPESA", forma_pagamento: "PIX", natureza: "CONSUMO", categorias: { nome: "+Categoria" } }]);
  assert.ok(csv.startsWith("\uFEFF"));
  assert.match(csv, /100,01/);
  assert.ok(csv.includes('"\'=SUM(1;2)\n""teste"""'));
  assert.ok(csv.includes("'+Categoria"));
});
test("zero e valores negativos não perdem centavos", () => {
  const base = { id: "1", descricao: "teste", data_compra: "2026-10-16", tipo: "RECEITA", forma_pagamento: "PIX", natureza: "CONSUMO", categorias: null };
  assert.match(exportarCsv([{ ...base, valor_total: -1 }]), /-0,01/);
  assert.match(exportarCsv([{ ...base, valor_total: 0 }]), /0,00/);
  assert.match(exportarCsv([{ ...base, valor_total: Number.MAX_SAFE_INTEGER }]), /90071992547409,91/);
  assert.throws(() => exportarCsv([{ ...base, valor_total: 1.5 }]), /centavos/);
});
test("arquivo vazio mantém cabeçalho", () => {
  assert.match(exportarCsv([]), /Descrição/);
});
