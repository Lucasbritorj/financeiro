import { test } from "node:test";
import assert from "node:assert/strict";
import { montarOpcoes, indiceValido, EXEMPLOS } from "../../src/lib/comando-opcoes.ts";
import type { Comando, ComandoTransacao } from "../../src/lib/comando.ts";

// Montagem da lista do Ctrl+K. Saiu de dentro do componente, então dá para
// exercitar cada forma de pagamento e cada tipo de comando sem renderizar.

const HOJE = "2026-07-09";

function transacao(over: Partial<ComandoTransacao> = {}): ComandoTransacao {
  return {
    tipo: "transacao",
    descricao: "ifood",
    valorCentavos: 4500,
    tipoTransacao: "DESPESA",
    forma: "PIX",
    cartaoId: null,
    cartaoNome: null,
    dataCompra: HOJE,
    numParcelas: 1,
    ...over,
  };
}

test("comando nulo cai nas sugestões de rota, filtradas pelo texto", () => {
  const todas = montarOpcoes(null, "", HOJE);
  assert.equal(todas.length, 8);
  assert.ok(todas.every((o) => o.acao.tipo === "rota"));

  const filtradas = montarOpcoes(null, "cof", HOJE);
  assert.deepEqual(
    filtradas.map((o) => o.id),
    ["/cofrinhos"],
  );
});

test("navegação vira uma opção de rota com o rótulo da tela", () => {
  const nav: Comando = { tipo: "navegacao", rota: "/analise", rotulo: "Análise" };
  assert.deepEqual(montarOpcoes(nav, "analise", HOJE), [
    { id: "/analise", titulo: "Ir para Análise", acao: { tipo: "rota", rota: "/analise" } },
  ]);
});

test("comando inválido não vira opção nenhuma", () => {
  // O motivo é mostrado como dica; não há o que executar.
  const invalido: Comando = { tipo: "invalido", motivo: "Receita não parcela." };
  assert.deepEqual(montarOpcoes(invalido, "x", HOJE), []);
});

test("transação do dia diz 'hoje' em vez da data", () => {
  const [op] = montarOpcoes(transacao(), "", HOJE);
  assert.match(op.detalhe ?? "", /^hoje · /);
});

test("transação de outro dia mostra a data formatada", () => {
  const [op] = montarOpcoes(transacao({ dataCompra: "2026-07-08" }), "", HOJE);
  assert.doesNotMatch(op.detalhe ?? "", /hoje/);
  assert.match(op.detalhe ?? "", /08/);
});

test("despesa e receita têm títulos distintos", () => {
  assert.match(montarOpcoes(transacao(), "", HOJE)[0].titulo, /Registrar despesa/);
  assert.match(
    montarOpcoes(transacao({ tipoTransacao: "RECEITA" }), "", HOJE)[0].titulo,
    /Registrar receita/,
  );
});

test("o título traz valor formatado e descrição", () => {
  const [op] = montarOpcoes(transacao({ valorCentavos: 123456, descricao: "notebook" }), "", HOJE);
  assert.match(op.titulo, /1\.234,56/);
  assert.match(op.titulo, /notebook/);
});

test("crédito parcelado mostra o cartão e o número de parcelas", () => {
  const [op] = montarOpcoes(
    transacao({ forma: "CREDITO", cartaoNome: "Nubank", numParcelas: 3 }),
    "",
    HOJE,
  );
  assert.match(op.detalhe ?? "", /Nubank em 3x/);
});

test("crédito em 1x não anuncia parcelamento", () => {
  const [op] = montarOpcoes(
    transacao({ forma: "CREDITO", cartaoNome: "Nubank", numParcelas: 1 }),
    "",
    HOJE,
  );
  assert.match(op.detalhe ?? "", /Nubank/);
  assert.doesNotMatch(op.detalhe ?? "", /1x/);
});

test("crédito sem nome de cartão cai num rótulo genérico", () => {
  const [op] = montarOpcoes(transacao({ forma: "CREDITO", cartaoNome: null }), "", HOJE);
  assert.match(op.detalhe ?? "", /Crédito/);
});

test("cada forma à vista tem seu rótulo em português", () => {
  const rotulo = (forma: ComandoTransacao["forma"]) =>
    montarOpcoes(transacao({ forma }), "", HOJE)[0].detalhe ?? "";
  assert.match(rotulo("PIX"), /Pix/);
  assert.match(rotulo("DEBITO"), /Débito/);
  assert.match(rotulo("DINHEIRO"), /Dinheiro/);
});

test("a opção de registrar tem id estável", () => {
  // O componente usa esse id para trocar o título por "Processando...".
  assert.equal(montarOpcoes(transacao(), "", HOJE)[0].id, "registrar");
});

test("indiceValido prende o cursor dentro da lista", () => {
  assert.equal(indiceValido(0, 3), 0);
  assert.equal(indiceValido(2, 3), 2);
  assert.equal(indiceValido(9, 3), 2); // lista encolheu sob o cursor
  assert.equal(indiceValido(4, 0), 0); // lista vazia não vira índice negativo
});

test("EXEMPLOS cita as quatro formas de uso do menu", () => {
  for (const trecho of ["45 ifood", "recebi", "em 5x", "ir para"]) {
    assert.ok(EXEMPLOS.includes(trecho), `faltou "${trecho}" nos exemplos`);
  }
});
