import { test } from "node:test";
import assert from "node:assert/strict";
import { mensagemPosTransacao } from "../../src/lib/nova-transacao.ts";

// T-05: definir_categoria_transacao era chamada sem desestruturar { error } —
// falha silenciosa: o usuário via "sucesso" mesmo quando a categoria não foi
// aplicada, distorcendo orçamento por categoria.

test("mensagemPosTransacao: sem erro de categoria, mensagem de sucesso pleno (T-05)", () => {
  const r = mensagemPosTransacao(3, null);
  assert.equal(r.tipo, "sucesso");
  assert.match(r.texto, /3 parcela/);
});

test("mensagemPosTransacao: erro ao definir categoria vira sucesso parcial com a mensagem real (T-05)", () => {
  const r = mensagemPosTransacao(1, {
    message: "Categoria não pertence ao usuário.",
    hint: "Escolha outra categoria.",
  });
  assert.equal(r.tipo, "erro");
  assert.match(r.texto, /Categoria não pertence ao usuário\./);
  assert.match(r.texto, /Escolha outra categoria\./);
  assert.match(r.texto, /transação/i); // deixa claro que a TRANSAÇÃO foi criada
});

test("mensagemPosTransacao: parcelas indefinidas cai pra 1 (mesmo default de antes)", () => {
  const r = mensagemPosTransacao(undefined, null);
  assert.match(r.texto, /1 parcela/);
});
