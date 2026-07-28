import { test } from "node:test";
import assert from "node:assert/strict";
import { hojeSaoPaulo } from "../../src/lib/data.ts";

// T-06: hojeSaoPaulo() estava duplicada, idêntica, em 8 arquivos. Extraída
// para um módulo único; este teste garante que a extração se comporta
// exatamente como as 8 cópias originais (mesma expressão, ver comentário).

test("hojeSaoPaulo: formato YYYY-MM-DD (T-06)", () => {
  const hoje = hojeSaoPaulo();
  assert.match(hoje, /^\d{4}-\d{2}-\d{2}$/);
});

test("hojeSaoPaulo: mesmo valor que a expressão original (Intl en-CA, America/Sao_Paulo) (T-06)", () => {
  const esperado = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
  }).format(new Date());
  assert.equal(hojeSaoPaulo(), esperado);
});
