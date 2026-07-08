import { test } from "node:test";
import assert from "node:assert/strict";
import {
  paraCentavos,
  formatarCentavos,
  formatarCompetencia,
  formatarData,
} from "../../src/lib/money.ts";

// Intl separa "R$" do valor com espaço não separável (U+00A0).
const nbsp = / /g;

test("paraCentavos: formato pt-BR com milhar e decimal", () => {
  assert.equal(paraCentavos("1.234,56"), 123456);
  assert.equal(paraCentavos("12.345.678,90"), 1234567890);
  assert.equal(paraCentavos("100,5"), 10050);
});

test("paraCentavos: formato US e inteiro puro", () => {
  assert.equal(paraCentavos("1234.56"), 123456);
  assert.equal(paraCentavos("1234"), 123400);
  assert.equal(paraCentavos("1234.5"), 123450);
});

test("paraCentavos: ponto seguido de 3 dígitos é milhar", () => {
  assert.equal(paraCentavos("1.234"), 123400);
  assert.equal(paraCentavos("12.345"), 1234500);
});

test("paraCentavos: prefixo R$ e espaços são ignorados", () => {
  assert.equal(paraCentavos("R$ 10,00"), 1000);
  assert.equal(paraCentavos(" 10 "), 1000);
});

test("paraCentavos: inválidos e não-positivos viram NaN", () => {
  assert.ok(Number.isNaN(paraCentavos("")));
  assert.ok(Number.isNaN(paraCentavos("abc")));
  assert.ok(Number.isNaN(paraCentavos("-5")));
  assert.ok(Number.isNaN(paraCentavos("0")));
});

test("paraCentavos: mais de 2 casas decimais arredonda para o centavo", () => {
  assert.equal(paraCentavos("100,555"), 10056);
  assert.equal(paraCentavos("1.2345"), 123);
  assert.ok(Number.isNaN(paraCentavos("0,004"))); // arredonda a 0 -> inválido
});

test("formatarCentavos: BRL pt-BR", () => {
  assert.equal(formatarCentavos(123456).replace(nbsp, " "), "R$ 1.234,56");
  assert.equal(formatarCentavos(0).replace(nbsp, " "), "R$ 0,00");
});

test("formatarCompetencia e formatarData", () => {
  assert.equal(formatarCompetencia("2026-02-01"), "fev/2026");
  assert.equal(formatarData("2026-02-28"), "28/02/2026");
});
