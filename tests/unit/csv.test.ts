import { test } from "node:test";
import assert from "node:assert/strict";
import {
  splitCsvLinha,
  detectarSeparador,
  normalizarData,
  valorParaCentavosAssinado,
  parseCsvExtrato,
} from "../../src/lib/csv.ts";

test("splitCsvLinha respeita aspas com separador interno", () => {
  assert.deepEqual(splitCsvLinha('2026-07-01,"Mercado, do bairro",-50.00', ","), [
    "2026-07-01",
    "Mercado, do bairro",
    "-50.00",
  ]);
  assert.deepEqual(splitCsvLinha('a;"b;c";d', ";"), ["a", "b;c", "d"]);
});

test("detectarSeparador escolhe o que gera mais colunas", () => {
  assert.equal(detectarSeparador("data,valor,descricao"), ",");
  assert.equal(detectarSeparador("data;valor;descricao"), ";");
});

test("normalizarData: ISO, BR e inválida", () => {
  assert.equal(normalizarData("2026-07-31"), "2026-07-31");
  assert.equal(normalizarData("31/07/2026"), "2026-07-31");
  assert.equal(normalizarData("31-07-2026"), "2026-07-31");
  assert.equal(normalizarData("julho"), null);
});

test("valorParaCentavosAssinado: sinais e formatos", () => {
  assert.equal(valorParaCentavosAssinado("-1.234,56"), -123456);
  assert.equal(valorParaCentavosAssinado("1234.56"), 123456);
  assert.equal(valorParaCentavosAssinado("R$ 10,00"), 1000);
  assert.equal(valorParaCentavosAssinado("+2500"), 250000);
  assert.equal(valorParaCentavosAssinado("0"), null);
  assert.equal(valorParaCentavosAssinado("abc"), null);
});

test("parseCsvExtrato: preset nubank (Data,Valor,Identificador,Descrição)", () => {
  const csv = [
    "Data,Valor,Identificador,Descrição",
    "05/07/2026,-41.00,abc123,IFOOD *RESTAURANTE",
    "01/07/2026,8500.00,def456,SALARIO EMPRESA",
    "linha,quebrada",
  ].join("\n");
  const r = parseCsvExtrato(csv, "nubank");
  assert.equal(r.linhas.length, 2);
  assert.equal(r.descartadas, 1);
  assert.deepEqual(r.linhas[0], {
    data: "2026-07-05",
    valor: -4100,
    descricao: "IFOOD *RESTAURANTE",
  });
  assert.equal(r.linhas[1].valor, 850000);
});

test("parseCsvExtrato: genérico detecta colunas pelo cabeçalho", () => {
  const csv = [
    "Data Lançamento;Histórico;Valor",
    "10/07/2026;SUPERMERCADO BOM;-620,00",
    "12/07/2026;PIX RECEBIDO;150,00",
  ].join("\n");
  const r = parseCsvExtrato(csv, "generico");
  assert.equal(r.linhas.length, 2);
  assert.equal(r.linhas[0].valor, -62000);
  assert.equal(r.linhas[1].descricao, "PIX RECEBIDO");
});

test("parseCsvExtrato: cabeçalho irreconhecível descarta tudo", () => {
  const csv = ["a;b;c", "1;2;3"].join("\n");
  const r = parseCsvExtrato(csv, "generico");
  assert.equal(r.linhas.length, 0);
  assert.equal(r.descartadas, 1);
});
