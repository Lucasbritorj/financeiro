import { test } from "node:test";
import assert from "node:assert/strict";
import {
  decidirEstrategiaEdicao,
  soMudouCamposLeves,
  type TransacaoOriginal,
  type EdicaoPretendida,
} from "../../src/lib/edicao-transacao.ts";

// A escolha da RPC de edição decide se as parcelas são MANTIDAS
// (editar_transacao) ou RECRIADAS (substituir_transacao). Escolher
// editar_transacao quando o parcelamento mudou deixa as parcelas
// dessincronizadas do cabeçalho — corrupção silenciosa de dado financeiro,
// que o usuário só descobre na fatura errada.

const CREDITO_3X: TransacaoOriginal = {
  tipo: "DESPESA",
  forma_pagamento: "CREDITO",
  num_parcelas: 3,
  categoria_id: "cat-mercado",
};

/** Estado do form que reproduz a transação sem nenhuma alteração estrutural. */
function semMudanca(o: TransacaoOriginal): EdicaoPretendida {
  return {
    tipo: o.tipo,
    forma: o.forma_pagamento,
    numParcelas: String(o.num_parcelas),
    categoriaId: o.categoria_id ?? "",
  };
}

test("só descrição/valor/data mudaram: usa a RPC barata que mantém as parcelas", () => {
  // descrição, valor e data nem entram na decisão — por isso "sem mudança"
  // aqui representa exatamente o caso de editar só esses três.
  assert.equal(
    decidirEstrategiaEdicao(CREDITO_3X, semMudanca(CREDITO_3X)),
    "editar_transacao",
  );
});

test("mudar a forma de pagamento recria a transação", () => {
  const edicao = { ...semMudanca(CREDITO_3X), forma: "PIX" };
  assert.equal(decidirEstrategiaEdicao(CREDITO_3X, edicao), "substituir_transacao");
});

test("mudar o tipo (despesa <-> receita) recria a transação", () => {
  const edicao = { ...semMudanca(CREDITO_3X), tipo: "RECEITA" };
  assert.equal(decidirEstrategiaEdicao(CREDITO_3X, edicao), "substituir_transacao");
});

test("mudar o número de parcelas em crédito recria a transação", () => {
  const edicao = { ...semMudanca(CREDITO_3X), numParcelas: "6" };
  assert.equal(decidirEstrategiaEdicao(CREDITO_3X, edicao), "substituir_transacao");
});

test("mudar a categoria recria: editar_transacao não recebe p_categoria_id", () => {
  // A categoria vive nas parcelas. editar_transacao não as toca, então
  // aceitar essa mudança pela via barata salvaria a categoria em lugar nenhum.
  const edicao = { ...semMudanca(CREDITO_3X), categoriaId: "cat-lazer" };
  assert.equal(decidirEstrategiaEdicao(CREDITO_3X, edicao), "substituir_transacao");
});

test('limpar a categoria ("" no select) conta como mudança e recria', () => {
  const edicao = { ...semMudanca(CREDITO_3X), categoriaId: "" };
  assert.equal(decidirEstrategiaEdicao(CREDITO_3X, edicao), "substituir_transacao");
});

test('categoria null no banco e "" no select são o MESMO estado, não uma mudança', () => {
  // Regressão: comparar "" com null direto marcaria toda transação sem
  // categoria como alterada, mandando pro caminho caro toda edição de
  // descrição — e recriando parcelas sem necessidade.
  const semCategoria: TransacaoOriginal = { ...CREDITO_3X, categoria_id: null };
  const edicao = { ...semMudanca(semCategoria), categoriaId: "" };
  assert.equal(soMudouCamposLeves(semCategoria, edicao), true);
  assert.equal(decidirEstrategiaEdicao(semCategoria, edicao), "editar_transacao");
});

test("parcelas só contam quando a forma pretendida é crédito", () => {
  // Em débito/pix/dinheiro o campo de parcelas nem é exibido, e o state
  // guarda o valor antigo. Deixar isso pesar na decisão mandaria uma edição
  // trivial de débito pro caminho caro.
  const debito: TransacaoOriginal = {
    tipo: "DESPESA",
    forma_pagamento: "DEBITO",
    num_parcelas: 1,
    categoria_id: null,
  };
  const edicao: EdicaoPretendida = {
    tipo: "DESPESA",
    forma: "DEBITO",
    numParcelas: "12", // resíduo do state, sem efeito fora do crédito
    categoriaId: "",
  };
  assert.equal(decidirEstrategiaEdicao(debito, edicao), "editar_transacao");
});

test("boleto usa a RPC própria, mesmo que nada tenha mudado", () => {
  const boleto: TransacaoOriginal = {
    tipo: "DESPESA",
    forma_pagamento: "BOLETO",
    num_parcelas: 1,
    categoria_id: null,
  };
  assert.equal(decidirEstrategiaEdicao(boleto, semMudanca(boleto)), "editar_boleto");
});

test("boleto tem precedência: nem trocar tipo/forma no state tira dele o form de boleto", () => {
  const boleto: TransacaoOriginal = {
    tipo: "DESPESA",
    forma_pagamento: "BOLETO",
    num_parcelas: 1,
    categoria_id: null,
  };
  const edicao: EdicaoPretendida = {
    tipo: "RECEITA",
    forma: "CREDITO",
    numParcelas: "9",
    categoriaId: "cat-outra",
  };
  assert.equal(decidirEstrategiaEdicao(boleto, edicao), "editar_boleto");
});
