import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseComando,
  sugerirRotas,
  type ContextoComando,
  type ComandoTransacao,
  type ComandoInvalido,
} from "../../src/lib/comando.ts";
import { MAX_PARCELAS_UI } from "../../src/lib/constantes.ts";

const HOJE = "2026-07-09";
const CTX: ContextoComando = {
  hoje: HOJE,
  cartoes: [
    { id: "c1", nome: "Nubank" },
    { id: "c2", nome: "Inter Gold" },
  ],
};
const SEM_CARTAO: ContextoComando = { hoje: HOJE, cartoes: [] };

function transacao(texto: string, ctx: ContextoComando = CTX): ComandoTransacao {
  const c = parseComando(texto, ctx);
  assert.equal(c?.tipo, "transacao", `esperava transação para "${texto}", veio ${JSON.stringify(c)}`);
  return c as ComandoTransacao;
}
function invalido(texto: string, ctx: ContextoComando = CTX): ComandoInvalido {
  const c = parseComando(texto, ctx);
  assert.equal(c?.tipo, "invalido", `esperava inválido para "${texto}", veio ${JSON.stringify(c)}`);
  return c as ComandoInvalido;
}

test("comando: despesa mínima cai nos defaults do formulário", () => {
  const c = transacao("50 ifood");
  assert.equal(c.valorCentavos, 5000);
  assert.equal(c.descricao, "ifood");
  assert.equal(c.tipoTransacao, "DESPESA");
  assert.equal(c.forma, "CREDITO");
  assert.equal(c.cartaoId, "c1"); // 1º cartão, como no form
  assert.equal(c.dataCompra, HOJE);
  assert.equal(c.numParcelas, 1);
});

test("comando: verbo de ruído, vírgula decimal e 'ontem'", () => {
  const c = transacao("lançar 89,90 ifood ontem");
  assert.equal(c.valorCentavos, 8990);
  assert.equal(c.descricao, "ifood");
  assert.equal(c.dataCompra, "2026-07-08");
});

test("comando: milhar pt-BR e 'reais de' como ruído", () => {
  assert.equal(transacao("1.234,56 reforma banheiro").valorCentavos, 123456);
  const c = transacao("50 reais de ifood");
  assert.equal(c.valorCentavos, 5000);
  assert.equal(c.descricao, "ifood");
});

test("comando: receita vai de Pix e aceita 'dia N'", () => {
  const c = transacao("recebi 4500 salário dia 5");
  assert.equal(c.tipoTransacao, "RECEITA");
  assert.equal(c.forma, "PIX");
  assert.equal(c.cartaoId, null);
  assert.equal(c.valorCentavos, 450000);
  assert.equal(c.descricao, "salário");
  assert.equal(c.dataCompra, "2026-07-05");
});

test("comando: parcelas com cartão nomeado ('em 5x no nubank')", () => {
  const c = transacao("500 notebook em 5x no nubank");
  assert.equal(c.numParcelas, 5);
  assert.equal(c.forma, "CREDITO");
  assert.equal(c.cartaoId, "c1");
  assert.equal(c.cartaoNome, "Nubank");
  assert.equal(c.descricao, "notebook");
});

test("comando: cartão com nome de duas palavras e '3x' sem 'em'", () => {
  const c = transacao("300 tênis 3x no inter gold");
  assert.equal(c.numParcelas, 3);
  assert.equal(c.cartaoId, "c2");
  assert.equal(c.descricao, "tênis");
});

test("comando: formas à vista explícitas zeram o cartão", () => {
  const debito = transacao("120 mercado no débito");
  assert.equal(debito.forma, "DEBITO");
  assert.equal(debito.cartaoId, null);
  assert.equal(transacao("45 uber pix").forma, "PIX");
  assert.equal(transacao("30 padaria dinheiro").forma, "DINHEIRO");
});

test("comando: datas dd/mm e dd/mm/aa", () => {
  assert.equal(transacao("60 presente 15/08").dataCompra, "2026-08-15");
  assert.equal(transacao("60 presente 01/02/25").dataCompra, "2025-02-01");
});

test("comando: sem cartão cadastrado o default é Pix", () => {
  const c = transacao("50 ifood", SEM_CARTAO);
  assert.equal(c.forma, "PIX");
  assert.equal(c.cartaoId, null);
});

test("comando: inválidos explicam o motivo", () => {
  assert.match(invalido("500 tv em 60x").motivo, /48 parcelas/);
  assert.match(invalido("500 tv em 3x", SEM_CARTAO).motivo, /cartão/);
  assert.match(invalido("recebi 100 bônus em 2x").motivo, /não parcela/);
  assert.match(invalido("50 mercado pix débito").motivo, /forma de pagamento/);
  assert.match(invalido("boleto luz 180").motivo, /formulário/);
  assert.match(invalido("50").motivo, /descrição/);
  assert.match(invalido("60 presente 31/02").motivo, /inválida/i);
  assert.match(invalido("100 assinatura no crédito", SEM_CARTAO).motivo, /cartão/);
});

test("comando: navegação com e sem verbo", () => {
  assert.deepEqual(parseComando("ir para cofrinhos", CTX), {
    tipo: "navegacao",
    rota: "/cofrinhos",
    rotulo: "Cofrinhos",
  });
  assert.equal(parseComando("análise", CTX)?.tipo, "navegacao");
  const contas = parseComando("ver contas a pagar", CTX);
  assert.equal(contas?.tipo === "navegacao" && contas.rota, "/faturas");
});

test("comando: sem valor não é transação (null) — menu mostra navegação", () => {
  assert.equal(parseComando("", CTX), null);
  assert.equal(parseComando("almoço com amigos", CTX), null);
});

test("sugerirRotas: prefixo filtra, vazio lista tudo", () => {
  assert.deepEqual(
    sugerirRotas("cof").map((r) => r.rota),
    ["/cofrinhos"],
  );
  assert.equal(sugerirRotas("").length, 8);
  assert.deepEqual(
    sugerirRotas("abrir importar").map((r) => r.rota),
    ["/importar"],
  );
});

// --- Caracterização: ramos que a suíte não alcançava antes do refactor de
// parseComando. Escritos contra o comportamento vigente, não contra o desejado:
// servem de rede para a extração dos extratores.

test("comando: 'anteontem' volta dois dias", () => {
  assert.equal(transacao("30 feira anteontem").dataCompra, "2026-07-07");
});

test("comando: teto de parcelas é o limite, não o limite menos um", () => {
  assert.equal(transacao(`500 tv em ${MAX_PARCELAS_UI}x`).numParcelas, MAX_PARCELAS_UI);
  assert.match(invalido(`500 tv em ${MAX_PARCELAS_UI + 1}x`).motivo, /parcelas/);
});

test("comando: '0x' é parcela abaixo do mínimo", () => {
  assert.match(invalido("500 tv em 0x").motivo, /mínimo 1/);
});

test("comando: 'em N vezes' equivale a 'Nx'", () => {
  const c = transacao("500 notebook em 4 vezes no nubank");
  assert.equal(c.numParcelas, 4);
  assert.equal(c.descricao, "notebook");
});

test("comando: 'dia N' inexistente no mês corrente é recusado", () => {
  // Julho tem 31 dias; 32 nunca casa o regex de 1-2 dígitos válidos.
  assert.match(invalido("60 presente dia 31", { ...CTX, hoje: "2026-06-09" }).motivo, /não existe/);
});

test("comando: cartão precedido de 'na' também é consumido", () => {
  const c = transacao("200 mercado na nubank");
  assert.equal(c.cartaoId, "c1");
  assert.equal(c.descricao, "mercado");
});

test("comando: nome de cartão mais longo ganha do mais curto", () => {
  const ctx: ContextoComando = {
    hoje: HOJE,
    cartoes: [
      { id: "curto", nome: "Inter" },
      { id: "longo", nome: "Inter Gold" },
    ],
  };
  assert.equal(transacao("300 tênis no inter gold", ctx).cartaoId, "longo");
  assert.equal(transacao("300 tênis no inter", ctx).cartaoId, "curto");
});

test("comando: data explícita com ano de 4 dígitos", () => {
  assert.equal(transacao("60 presente 15/08/2027").dataCompra, "2027-08-15");
});

test("comando: 'crédito' explícito mantém o cartão nomeado", () => {
  const c = transacao("400 tv no crédito no inter gold");
  assert.equal(c.forma, "CREDITO");
  assert.equal(c.cartaoId, "c2");
});

test("comando: receita à vista explícita não conflita", () => {
  const c = transacao("recebi 200 freela pix");
  assert.equal(c.tipoTransacao, "RECEITA");
  assert.equal(c.forma, "PIX");
});
