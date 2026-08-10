import { test } from "node:test";
import assert from "node:assert/strict";
import {
  formatarValorSerie,
  formatarReferenciaSerie,
  SERIES_BCB,
} from "../../src/lib/bcb.ts";

test("formatarValorSerie: moeda, taxa anual e percentual em pt-BR", () => {
  assert.equal(formatarValorSerie("moeda", "5.1329"), "R$ 5,13");
  assert.equal(formatarValorSerie("moeda", "5.8720000"), "R$ 5,87");
  assert.equal(formatarValorSerie("taxaAno", "14.15"), "14,15% a.a.");
  assert.equal(formatarValorSerie("percentualMensal", "0.58"), "0,58%");
  assert.equal(formatarValorSerie("percentualMensal", "-0.50"), "-0,50%");
});

test("formatarValorSerie: lixo da API vira erro explícito, nunca valor plausível", () => {
  assert.throws(() => formatarValorSerie("moeda", "abc"), /não numérico/);
  assert.throws(() => formatarValorSerie("taxaAno", ""), /não numérico/);
});

test("formatarReferenciaSerie: diário dd/mm, mensal mmm/aa", () => {
  assert.equal(formatarReferenciaSerie("moeda", "09/07/2026"), "09/07");
  assert.equal(formatarReferenciaSerie("taxaAno", "08/07/2026"), "08/07");
  assert.equal(formatarReferenciaSerie("percentualMensal", "01/05/2026"), "mai/26");
  assert.equal(formatarReferenciaSerie("percentualMensal", "01/12/2025"), "dez/25");
  assert.throws(() => formatarReferenciaSerie("moeda", "2026-07-09"), /inesperado/);
});

test("SERIES_BCB: códigos únicos e rotulados", () => {
  const codigos = SERIES_BCB.map((s) => s.codigo);
  assert.equal(new Set(codigos).size, codigos.length);
  for (const s of SERIES_BCB) assert.ok(s.rotulo.length > 0);
});
