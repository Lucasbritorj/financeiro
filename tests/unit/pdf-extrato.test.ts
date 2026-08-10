import { test } from "node:test";
import assert from "node:assert/strict";
import { parsePdfExtrato } from "../../src/lib/pdf-extrato.ts";

test("parsePdfExtrato: linha comum vira despesa; 'C' vira receita", () => {
  const r = parsePdfExtrato(
    [
      "Extrato de Conta Corrente",           // ruído sem data: não conta
      "05/07/2026 IFOOD *RESTAURANTE 89,90",
      "01/07/2026 TED RECEBIDA ACME 4.500,00 C",
      "03/07/2026 SUPERMERCADO PAGUE MENOS 1.234,56 D",
      "Página 1 de 2",
    ],
    2026,
  );
  assert.equal(r.descartadas, 0);
  assert.deepEqual(r.linhas, [
    { data: "2026-07-05", valor: -8990, descricao: "IFOOD *RESTAURANTE" },
    { data: "2026-07-01", valor: 450000, descricao: "TED RECEBIDA ACME" },
    { data: "2026-07-03", valor: -123456, descricao: "SUPERMERCADO PAGUE MENOS" },
  ]);
});

test("parsePdfExtrato: dd/mm sem ano usa o ano de referência", () => {
  const r = parsePdfExtrato(["09/07 UBER TRIP 25,00"], 2026);
  assert.deepEqual(r.linhas, [{ data: "2026-07-09", valor: -2500, descricao: "UBER TRIP" }]);
});

test("parsePdfExtrato: dois valores na linha usa o último (1º é documento)", () => {
  const r = parsePdfExtrato(["02/07/2026 BOLETO 341,00 PAGAMENTO ENERGIA 189,90"], 2026);
  assert.equal(r.linhas.length, 1);
  assert.equal(r.linhas[0].valor, -18990);
});

test("parsePdfExtrato: linha de saldo e data sem valor são descartadas contadas", () => {
  const r = parsePdfExtrato(
    ["05/07/2026 SALDO DO DIA 10.000,00", "06/07/2026 TARIFA BANCARIA"],
    2026,
  );
  assert.equal(r.linhas.length, 0);
  assert.equal(r.descartadas, 2);
});

// T-02: RE_VALOR_TOKEN tinha uma alternativa com \d+ (sem vírgula garantida)
// que causa backtracking O(n²) quando a linha tem uma corrida longa de
// dígitos sem vírgula (PDF hostil, sem worker/timeout no browser). Medido:
// n=25000 -> ~192ms; n=200000 -> ~12s. Teste de tempo é frágil por natureza,
// então usamos um teto BEM generoso (1s): a versão corrigida processa isso
// em poucos ms, então qualquer coisa perto de 1s já denuncia volta do
// backtracking quadrático (ou de alguma outra regressão de performance
// equivalente), sem exigir precisão de benchmark.
test("parsePdfExtrato: linha hostil com corrida longa de dígitos sem vírgula não trava (T-02)", () => {
  const digitos = "1".repeat(200000);
  const linha = `01/01/2026 ${digitos}`;
  const inicio = Date.now();
  parsePdfExtrato([linha], 2026);
  const duracaoMs = Date.now() - inicio;
  assert.ok(
    duracaoMs < 1000,
    `esperado < 1000ms, levou ${duracaoMs}ms (backtracking O(n²) da regex de valor?)`,
  );
});
