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
