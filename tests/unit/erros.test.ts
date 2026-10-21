import { test } from "node:test";
import assert from "node:assert/strict";
import { mensagemDeErro } from "../../src/lib/erros.ts";

test("mensagemDeErro: concatena hint quando presente", () => {
  assert.equal(
    mensagemDeErro({ code: "FW409", message: "Limite excedido.", hint: "Pague faturas pendentes." }),
    "Limite excedido. Pague faturas pendentes."
  );
});

test("mensagemDeErro: sem hint devolve só a mensagem", () => {
  assert.equal(mensagemDeErro({ code: "FW400", message: "Falhou." }), "Falhou.");
  assert.equal(mensagemDeErro({ code: "FW400", message: "Falhou.", hint: null }), "Falhou.");
  assert.equal(mensagemDeErro({ code: "FW400", message: "Falhou.", hint: "" }), "Falhou.");
});

// Estes casos existem porque a assinatura era `ErroComHint` e quebrava o build
// nos dois `catch` de use-importacao.ts, onde o valor é `unknown`.
test("mensagemDeErro: aceita o que vem de um catch", () => {
  assert.equal(mensagemDeErro(new Error("Rede caiu.")), "Erro inesperado. Tente de novo.");
  assert.equal(mensagemDeErro(new TypeError("x.y não é função")), "Erro inesperado. Tente de novo.");
});

test('erros de banco e caminhos internos são ocultos; códigos Auth conhecidos são traduzidos',()=>{
 for(const e of [{code:'23505',message:'duplicate key violates constraint transacoes_pkey',hint:'private_table'}, {message:'C:/private/arquivo.ts:1'}, {code:'FW500',message:'internal failure'}])assert.equal(mensagemDeErro(e),'Erro inesperado. Tente de novo.');
 assert.equal(mensagemDeErro({code:'invalid_credentials',message:'internal'}),'E-mail ou senha inválidos.');
});

test("mensagemDeErro: valor irreconhecível não vira 'undefined' na tela", () => {
  for (const v of [undefined, null, "string solta", 42, {}, { message: 7 }]) {
    assert.equal(mensagemDeErro(v), "Erro inesperado. Tente de novo.");
  }
});
