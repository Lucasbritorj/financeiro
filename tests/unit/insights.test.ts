import { test } from "node:test";
import assert from "node:assert/strict";
import {
  nomeMes,
  resumoDoMes,
  gastoPorCategoria,
  variacaoPercentual,
  projecaoFechamento,
  taxaPoupanca,
  topDespesas,
  envelopesEstourados,
  montarFraseHeroi,
  deslocarMes,
  historicoMensal,
  ultimoMesComDados,
  type TransacaoInsight,
} from "../../src/lib/insights.ts";

const catDelivery = { id: "c1", nome: "Delivery", cor: "#D6674E", orcamento_mensal: 35000 };
const catMercado = { id: "c2", nome: "Mercado", cor: "#7CB49A", orcamento_mensal: 80000 };

function t(
  valor: number,
  tipo: "DESPESA" | "RECEITA",
  data: string,
  categoria: TransacaoInsight["categoria"] = null,
  descricao = "x"
): TransacaoInsight {
  return { descricao, valor_total: valor, tipo, data_compra: data, categoria };
}

const transacoes: TransacaoInsight[] = [
  t(41000, "DESPESA", "2026-07-05", catDelivery, "IFOOD"),
  t(62000, "DESPESA", "2026-07-10", catMercado, "SUPERMERCADO"),
  t(15000, "DESPESA", "2026-07-12", null, "avulso"),
  t(850000, "RECEITA", "2026-07-01", null, "salário"),
  t(70000, "DESPESA", "2026-06-15", catMercado, "SUPERMERCADO"),
];

test("resumoDoMes soma só o mês pedido", () => {
  const r = resumoDoMes(transacoes, "2026-07");
  assert.equal(r.entradas, 850000);
  assert.equal(r.saidas, 118000);
  assert.equal(r.saldo, 732000);
});

test("gastoPorCategoria agrupa, ordena desc e preserva orçamento", () => {
  const cats = gastoPorCategoria(transacoes, "2026-07");
  assert.equal(cats.length, 3);
  assert.equal(cats[0].nome, "Mercado");
  assert.equal(cats[0].gasto, 62000);
  assert.equal(cats[1].nome, "Delivery");
  assert.equal(cats[1].orcamento, 35000);
  assert.equal(cats[2].nome, "Sem categoria");
  assert.equal(cats[2].id, null);
});

test("envelopesEstourados detecta gasto > orçamento", () => {
  const cats = gastoPorCategoria(transacoes, "2026-07");
  const estouradas = envelopesEstourados(cats);
  assert.equal(estouradas.length, 1);
  assert.equal(estouradas[0].nome, "Delivery"); // 410 > 350
});

test("variacaoPercentual: sinal e base zero", () => {
  assert.equal(variacaoPercentual(88000, 100000), -12);
  assert.equal(variacaoPercentual(110000, 100000), 10);
  assert.equal(variacaoPercentual(100000, 0), null);
});

test("projecaoFechamento e taxaPoupanca", () => {
  assert.equal(projecaoFechamento(330000, 23, 31), 444783);
  assert.equal(projecaoFechamento(0, 0, 31), 0);
  assert.equal(taxaPoupanca(850000, 663000), 22);
  assert.equal(taxaPoupanca(0, 100), null);
});

test("topDespesas ordena e corta", () => {
  const top = topDespesas(transacoes, "2026-07", 2);
  assert.equal(top.length, 2);
  assert.equal(top[0].valor_total, 62000);
  assert.equal(top[1].valor_total, 41000);
});

test("frase-herói: caso completo (delta + estouro + dentro do plano)", () => {
  const cats = gastoPorCategoria(transacoes, "2026-07");
  const frase = montarFraseHeroi({
    mesISO: "2026-07",
    gastoMes: 118000,
    gastoMesAnterior: 134000,
    categorias: cats,
    formatar: (c) => `R$ ${(c / 100).toFixed(0)}`,
  });
  const texto = frase.map((s) => s.texto).join("");
  assert.match(texto, /Você já gastou R\$ 1180 em julho/);
  assert.match(texto, /12% abaixo/);
  assert.match(texto, /Delivery passou do limite/);
  assert.match(texto, /Mercado está dentro do plano/);
  assert.equal(frase.find((s) => s.texto.includes("Delivery"))?.enfase, "telha");
});

test("frase-herói: mês vazio vira convite; sem histórico anota 1º mês", () => {
  const vazia = montarFraseHeroi({
    mesISO: "2026-07",
    gastoMes: 0,
    gastoMesAnterior: 0,
    categorias: [],
    formatar: String,
  });
  assert.match(vazia.map((s) => s.texto).join(""), /Nenhum gasto lançado em julho/);

  const primeira = montarFraseHeroi({
    mesISO: "2026-07",
    gastoMes: 5000,
    gastoMesAnterior: 0,
    categorias: [],
    formatar: String,
  });
  assert.match(primeira.map((s) => s.texto).join(""), /primeiro mês com dados/);
});

test("nomeMes", () => {
  assert.equal(nomeMes("2026-07"), "julho");
  assert.equal(nomeMes("2026-01"), "janeiro");
});

test("deslocarMes soma/subtrai cruzando ano", () => {
  assert.equal(deslocarMes("2026-07", 1), "2026-08");
  assert.equal(deslocarMes("2026-01", -1), "2025-12");
  assert.equal(deslocarMes("2026-12", 1), "2027-01");
});

test("historicoMensal resume cada mês na ordem", () => {
  const h = historicoMensal(transacoes, ["2026-06", "2026-07"]);
  assert.equal(h.length, 2);
  assert.equal(h[0].mes, "2026-06");
  assert.equal(h[0].saidas, 70000);
  assert.equal(h[1].mes, "2026-07");
  assert.equal(h[1].entradas, 850000);
});

test("ultimoMesComDados acha a competência mais recente", () => {
  assert.equal(ultimoMesComDados(transacoes), "2026-07");
  assert.equal(ultimoMesComDados([]), null);
});

// 0023 — conciliação fatura × extrato.
// Pagamento de fatura importado do extrato NÃO é consumo novo: quita compras
// que já somaram no mês em que aconteceram. Sem este filtro, a compra conta
// no mês da compra e o pagamento no mês do pagamento — dobro, em meses
// diferentes, o que não parece duplicata e passa despercebido.
const COMPRA_CREDITO: TransacaoInsight = {
  descricao: "COMPRA TESTE",
  valor_total: 50000,
  tipo: "DESPESA",
  data_compra: "2026-03-05",
  natureza: "CONSUMO",
  categoria: null,
};
const LIQUIDACAO: TransacaoInsight = {
  descricao: "PAGAMENTO FATURA CARTAO",
  valor_total: 50000,
  tipo: "DESPESA",
  data_compra: "2026-04-10",
  natureza: "LIQUIDACAO_FATURA",
  categoria: null,
};

test("resumoDoMes: liquidação de fatura não soma no mês do pagamento", () => {
  const base = [COMPRA_CREDITO, LIQUIDACAO];
  assert.equal(resumoDoMes(base, "2026-03").saidas, 50000);
  assert.equal(resumoDoMes(base, "2026-04").saidas, 0);
  // O total dos dois meses é o consumo real, não o dobro.
  const total =
    resumoDoMes(base, "2026-03").saidas + resumoDoMes(base, "2026-04").saidas;
  assert.equal(total, 50000);
});

test("resumoDoMes: natureza ausente ou null conta como CONSUMO (dado pré-0023)", () => {
  const semCampo = { ...COMPRA_CREDITO } as TransacaoInsight;
  delete (semCampo as { natureza?: unknown }).natureza;
  assert.equal(resumoDoMes([semCampo], "2026-03").saidas, 50000);
  assert.equal(
    resumoDoMes([{ ...COMPRA_CREDITO, natureza: null }], "2026-03").saidas,
    50000,
  );
});

test("gastoPorCategoria: liquidação não entra no donut", () => {
  const g = gastoPorCategoria([COMPRA_CREDITO, LIQUIDACAO], "2026-04");
  assert.deepEqual(g, []);
});
