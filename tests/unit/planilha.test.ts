import { test } from "node:test";
import assert from "node:assert/strict";
import { parseMatrizExtrato } from "../../src/lib/csv.ts";

test("parseMatrizExtrato: detecta colunas pelo cabeçalho e converte", () => {
  const r = parseMatrizExtrato([
    ["Data", "Descrição", "Valor"],
    ["05/07/2026", "IFOOD", "-89,90"],
    ["01/07/2026", "SALÁRIO", "4500,00"],
    ["", "", ""],
    ["lixo", "sem data", "abc"],
  ]);
  assert.equal(r.descartadas, 1);
  assert.deepEqual(r.linhas, [
    { data: "2026-07-05", valor: -8990, descricao: "IFOOD" },
    { data: "2026-07-01", valor: 450000, descricao: "SALÁRIO" },
  ]);
});

test("parseMatrizExtrato: número com ponto decimal (célula numérica do Excel)", () => {
  const r = parseMatrizExtrato([
    ["date", "title", "amount"],
    ["2026-07-05", "Uber", "-25.5"],
  ]);
  assert.deepEqual(r.linhas, [{ data: "2026-07-05", valor: -2550, descricao: "Uber" }]);
});

test("parseMatrizExtrato: sem cabeçalho reconhecível devolve tudo descartado", () => {
  const r = parseMatrizExtrato([
    ["a", "b", "c"],
    ["1", "2", "3"],
  ]);
  assert.equal(r.linhas.length, 0);
  assert.equal(r.descartadas, 1);
});
