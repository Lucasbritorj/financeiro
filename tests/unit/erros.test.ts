import { test } from "node:test";
import assert from "node:assert/strict";
import { mensagemDeErro } from "../../src/lib/erros.ts";

test("mensagemDeErro: concatena hint quando presente", () => {
  assert.equal(
    mensagemDeErro({ message: "Limite excedido.", hint: "Pague faturas pendentes." }),
    "Limite excedido. Pague faturas pendentes."
  );
});

test("mensagemDeErro: sem hint devolve só a mensagem", () => {
  assert.equal(mensagemDeErro({ message: "Falhou." }), "Falhou.");
  assert.equal(mensagemDeErro({ message: "Falhou.", hint: null }), "Falhou.");
  assert.equal(mensagemDeErro({ message: "Falhou.", hint: "" }), "Falhou.");
});

// Estes casos existem porque a assinatura era `ErroComHint` e quebrava o build
// nos dois `catch` de use-importacao.ts, onde o valor é `unknown`.
test("mensagemDeErro: aceita o que vem de um catch", () => {
  assert.equal(mensagemDeErro(new Error("Rede caiu.")), "Rede caiu.");
  assert.equal(mensagemDeErro(new TypeError("x.y não é função")), "x.y não é função");
});

test("mensagemDeErro: valor irreconhecível não vira 'undefined' na tela", () => {
  for (const v of [undefined, null, "string solta", 42, {}, { message: 7 }]) {
    assert.equal(mensagemDeErro(v), "Erro inesperado. Tente de novo.");
  }
});
