import { test } from "node:test";
import assert from "node:assert/strict";
import {
  paraCentavos,
  paraCentavosAssinado,
  centavosParaDecimalEditavel,
  formatarCentavos,
  formatarCentavosAcessivel,
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

test("paraCentavosAssinado: sinal, milhar e zero", () => {
  assert.equal(paraCentavosAssinado("1.234,56"), 123456);
  assert.equal(paraCentavosAssinado("-1.234,56"), -123456);
  assert.equal(paraCentavosAssinado("+89,90"), 8990);
  assert.equal(paraCentavosAssinado("-89.9"), -8990);
  assert.equal(paraCentavosAssinado("R$ 10,00"), 1000);
  assert.equal(paraCentavosAssinado("0,00"), null); // arredonda a zero -> null
  assert.equal(paraCentavosAssinado("abc"), null);
});

test("paraCentavosAssinado: parser único aceita milhar em todos os formatos de importação (regressão da divergência OFX)", () => {
  // Antes, o parser estrito do OFX rejeitava separador de milhar que o CSV
  // aceitava; agora os três delegam à mesma função e concordam.
  assert.equal(paraCentavosAssinado("1.234,56"), 123456);
  assert.equal(paraCentavosAssinado("12.345.678,90"), 1234567890);
});

test("centavosParaDecimalEditavel: centavos -> string editável pt-BR sem moeda", () => {
  assert.equal(centavosParaDecimalEditavel(123456), "1234,56");
  assert.equal(centavosParaDecimalEditavel(1000), "10,00");
  assert.equal(centavosParaDecimalEditavel(5), "0,05");
});

test("formatarCentavos: BRL pt-BR", () => {
  assert.equal(formatarCentavos(123456).replace(nbsp, " "), "R$ 1.234,56");
  assert.equal(formatarCentavos(0).replace(nbsp, " "), "R$ 0,00");
});

test("formatarCentavosAcessivel: leitura BRL para leitor de tela", () => {
  assert.equal(formatarCentavosAcessivel(123456), "1.234 reais e 56 centavos");
  assert.equal(formatarCentavosAcessivel(100), "1 real");
  assert.equal(formatarCentavosAcessivel(101), "1 real e 1 centavo");
  assert.equal(formatarCentavosAcessivel(-8990), "menos 89 reais e 90 centavos");
  assert.equal(formatarCentavosAcessivel(5), "0 reais e 5 centavos");
});

test("formatarCompetencia e formatarData", () => {
  assert.equal(formatarCompetencia("2026-02-01"), "fev/2026");
  assert.equal(formatarData("2026-02-28"), "28/02/2026");
});
