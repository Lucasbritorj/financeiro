import { test } from "node:test";
import assert from "node:assert/strict";
import { celulaParaTexto, linhasDaPagina } from "../../src/lib/leitura-arquivo.ts";

// Estas duas eram funções internas de importador-csv.tsx e nunca tiveram
// cobertura: eram inalcançáveis sem renderizar o componente. São o ponto onde
// uma planilha ou um PDF passa a ser lido errado sem nada estourar.

test("celulaParaTexto: vazio para null e undefined", () => {
  assert.equal(celulaParaTexto(null), "");
  assert.equal(celulaParaTexto(undefined), "");
});

test("celulaParaTexto: Date vira dd/mm/aaaa em UTC", () => {
  // UTC, não fuso local: a data de uma planilha não pode andar um dia.
  assert.equal(celulaParaTexto(new Date("2026-03-09T00:00:00Z")), "09/03/2026");
  assert.equal(celulaParaTexto(new Date("2026-12-31T23:59:59Z")), "31/12/2026");
});

test("celulaParaTexto: richText concatena os pedaços", () => {
  assert.equal(
    celulaParaTexto({ richText: [{ text: "PIX " }, { text: "MERCADO" }] }),
    "PIX MERCADO",
  );
  assert.equal(celulaParaTexto({ richText: [] }), "");
});

test("celulaParaTexto: fórmula usa o resultado, e resultado nulo vira vazio", () => {
  assert.equal(celulaParaTexto({ formula: "A1*2", result: -4550 }), "-4550");
  assert.equal(celulaParaTexto({ formula: "A1*2", result: null }), "");
});

test("celulaParaTexto: número e string caem no String()", () => {
  assert.equal(celulaParaTexto(-89.9), "-89.9");
  assert.equal(celulaParaTexto("ifood"), "ifood");
  assert.equal(celulaParaTexto(0), "0");
});

function item(str: string, x: number, y: number) {
  // transform do pdfjs: [a, b, c, d, e=x, f=y]
  return { str, transform: [1, 0, 0, 1, x, y] };
}

test("linhasDaPagina: agrupa por Y e ordena da esquerda para a direita", () => {
  assert.deepEqual(
    linhasDaPagina([
      item("MERCADO", 200, 500),
      item("09/03", 100, 500),
      item("-45,50", 300, 500),
    ]),
    ["09/03 MERCADO -45,50"],
  );
});

test("linhasDaPagina: do topo para a base, não pela ordem de leitura", () => {
  // Y maior é mais alto na página: a linha de Y=500 vem antes da de Y=480.
  assert.deepEqual(
    linhasDaPagina([item("segunda", 10, 480), item("primeira", 10, 500)]),
    ["primeira", "segunda"],
  );
});

test("linhasDaPagina: descarta pedaço em branco e item sem str", () => {
  assert.deepEqual(
    linhasDaPagina([item("   ", 10, 500), item("real", 20, 500), { transform: [1, 0, 0, 1, 30, 500] }]),
    ["real"],
  );
  assert.deepEqual(linhasDaPagina([]), []);
});

test("linhasDaPagina: Y fracionário arredonda para a mesma linha", () => {
  assert.deepEqual(
    linhasDaPagina([item("a", 10, 500.4), item("b", 20, 499.8)]),
    ["a b"],
  );
});
