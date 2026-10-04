import { test } from "node:test";
import assert from "node:assert/strict";
import { montarContexto, SISTEMA_ASSISTENTE } from "../../src/lib/assistente/contexto.ts";
import type { TransacaoInsight } from "../../src/lib/insights.ts";

// node --test roda cada arquivo em processo próprio, então fixar TZ=UTC aqui
// vale só para esta suíte: empurra o fuso local do runner para longe de
// America/Sao_Paulo e faz o bug de fuso (mês corrente e ano do PDF decididos no
// fuso local, não em SP) aparecer no vermelho. O código corrigido decide por SP
// via Intl e passa com qualquer TZ.
process.env.TZ = "UTC";

// A invariante que este arquivo protege: o assistente manda AGREGADOS ao modelo,
// nunca o razão bruto. Descrição de transação é dado sensível — "Consulta Dr.
// Silva", "Advogado Trabalhista", o nome de quem recebeu um Pix — e não é
// necessária para responder "onde cortar R$ 200", que se resolve com "Delivery
// R$ 812 contra orçamento de R$ 350".
//
// O teste central serializa o contexto inteiro e falha se qualquer descrição
// aparecer. É o mesmo espírito do gate que lê src/app/(protegido) do disco: um
// campo novo em ContextoAssistente que arraste descrição junto cai aqui sozinho,
// sem ninguém precisar lembrar de atualizar o teste.

const DESCRICOES_SENSIVEIS = [
  "Consulta Dra Marina Psiquiatra",
  "Advogado divorcio - entrada",
  "Pix para Joao Batista Silva",
  "Farmacia - medicamento controlado",
];

function t(
  parcial: Partial<TransacaoInsight> & { descricao: string; data_compra: string },
): TransacaoInsight {
  return {
    valor_total: 10000,
    tipo: "DESPESA",
    categoria: null,
    ...parcial,
  } as TransacaoInsight;
}

const CAT_SAUDE = { id: "c1", nome: "Saúde", cor: "#0a0", orcamento_mensal: 50000 };
const CAT_DELIVERY = { id: "c2", nome: "Delivery", cor: "#a00", orcamento_mensal: 35000 };

const TRANSACOES: TransacaoInsight[] = [
  t({ descricao: DESCRICOES_SENSIVEIS[0], data_compra: "2026-09-03", valor_total: 45000, categoria: CAT_SAUDE }),
  t({ descricao: DESCRICOES_SENSIVEIS[1], data_compra: "2026-09-07", valor_total: 300000, categoria: null }),
  t({ descricao: DESCRICOES_SENSIVEIS[2], data_compra: "2026-09-11", valor_total: 25000, categoria: null }),
  t({ descricao: DESCRICOES_SENSIVEIS[3], data_compra: "2026-09-15", valor_total: 8000, categoria: CAT_SAUDE }),
  t({ descricao: "iFood", data_compra: "2026-09-18", valor_total: 81200, categoria: CAT_DELIVERY }),
  t({ descricao: "Salario", data_compra: "2026-09-05", valor_total: 900000, tipo: "RECEITA", categoria: null }),
  // Mês anterior, para o histórico ter mais de uma linha
  t({ descricao: DESCRICOES_SENSIVEIS[0], data_compra: "2026-08-03", valor_total: 45000, categoria: CAT_SAUDE }),
];

const HOJE = new Date(2026, 8, 20); // 20/09/2026 — mês corrente do fixture

test("NENHUMA descrição de transação chega ao contexto enviado ao modelo", () => {
  const ctx = montarContexto(TRANSACOES, "2026-09", HOJE);
  const serializado = JSON.stringify(ctx);
  for (const descricao of DESCRICOES_SENSIVEIS) {
    assert.ok(
      !serializado.includes(descricao),
      `a descrição "${descricao}" vazou para o contexto do modelo`,
    );
  }
  // Também nenhum fragmento identificável de pessoa
  for (const fragmento of ["Marina", "Joao Batista", "divorcio", "controlado"]) {
    assert.ok(
      !serializado.includes(fragmento),
      `o fragmento "${fragmento}" vazou para o contexto do modelo`,
    );
  }
});

test("o contexto tem só os tipos permitidos: número, data, nome de categoria", () => {
  const ctx = montarContexto(TRANSACOES, "2026-09", HOJE);
  const nomesDeCategoria = new Set(ctx.categorias.map((c) => c.nome));
  // Varre recursivamente: toda string precisa ser justificável.
  const permitidas = new Set([
    ...nomesDeCategoria,
    "BRL",
    "centavos",
    ctx.mes_referencia,
    ctx.mes_nome,
    ...ctx.historico.flatMap((h) => [h.mes, h.mes_nome]),
  ]);
  const varrer = (v: unknown, caminho: string): void => {
    if (typeof v === "string") {
      assert.ok(
        permitidas.has(v),
        `string inesperada em ${caminho}: ${JSON.stringify(v)} — só número, data e nome de categoria podem sair daqui`,
      );
    } else if (Array.isArray(v)) {
      v.forEach((x, i) => varrer(x, `${caminho}[${i}]`));
    } else if (v && typeof v === "object") {
      for (const [k, x] of Object.entries(v)) varrer(x, `${caminho}.${k}`);
    }
  };
  varrer(ctx, "contexto");
});

test("agrega os números certos do mês", () => {
  const ctx = montarContexto(TRANSACOES, "2026-09", HOJE);
  assert.equal(ctx.entradas, 900000);
  assert.equal(ctx.saidas, 45000 + 300000 + 25000 + 8000 + 81200);
  assert.equal(ctx.saldo, ctx.entradas - ctx.saidas);
  assert.equal(ctx.total_transacoes_no_mes, 6);
});

test("categoria estourada é marcada", () => {
  const ctx = montarContexto(TRANSACOES, "2026-09", HOJE);
  const delivery = ctx.categorias.find((c) => c.nome === "Delivery");
  assert.ok(delivery, "Delivery ausente");
  assert.equal(delivery.gasto, 81200);
  assert.equal(delivery.orcamento, 35000);
  assert.equal(delivery.estourado, true, "gasto 812 sobre orçamento 350 não foi marcado");

  const saude = ctx.categorias.find((c) => c.nome === "Saúde");
  assert.ok(saude, "Saúde ausente");
  assert.equal(saude.gasto, 53000);
  assert.equal(saude.estourado, true);
});

test("projeção só existe no mês corrente — mês fechado não recebe número inventado", () => {
  const corrente = montarContexto(TRANSACOES, "2026-09", HOJE);
  assert.equal(typeof corrente.projecao_fechamento, "number");

  const fechado = montarContexto(TRANSACOES, "2026-08", HOJE);
  assert.equal(
    fechado.projecao_fechamento,
    null,
    "mês fechado ganhou projeção: o valor real já é conhecido, projetar seria inventar",
  );
});

test("liquidação de fatura não é contada como gasto novo", () => {
  // Regra da 0023: o pagamento da fatura quita consumo já somado nas parcelas.
  const comLiquidacao: TransacaoInsight[] = [
    ...TRANSACOES,
    t({
      descricao: "Pagamento fatura Itau",
      data_compra: "2026-09-10",
      valor_total: 500000,
      natureza: "LIQUIDACAO_FATURA",
    }),
  ];
  const semLiq = montarContexto(TRANSACOES, "2026-09", HOJE);
  const comLiq = montarContexto(comLiquidacao, "2026-09", HOJE);
  assert.equal(comLiq.saidas, semLiq.saidas, "liquidação de fatura dobrou o gasto do mês");
});

test("mês sem dado devolve zeros, não quebra nem inventa", () => {
  const ctx = montarContexto([], "2026-09", HOJE);
  assert.equal(ctx.entradas, 0);
  assert.equal(ctx.saidas, 0);
  assert.equal(ctx.taxa_poupanca_pct, null, "sem entradas, taxa de poupança tem de ser null");
  assert.deepEqual(ctx.categorias, []);
  assert.equal(ctx.total_transacoes_no_mes, 0);
});

test("o prompt do sistema declara a unidade e a ausência do razão", () => {
  // Instrução que promete dado que o contexto não carrega faz o modelo inventar.
  assert.match(SISTEMA_ASSISTENTE, /CENTAVOS/);
  assert.match(SISTEMA_ASSISTENTE, /NÃO tem acesso a transações individuais/);
  assert.match(SISTEMA_ASSISTENTE, /não é consultor de investimentos/i);
});

// --- Fuso America/Sao_Paulo (lote financeiro-web-lote-fuso-testes) ---
// Com TZ=UTC no topo, o fuso local do runner é UTC. montarContexto e o ano do
// extrato PDF têm de decidir pelo fuso de negócio (America/Sao_Paulo), não pelo
// local — senão, entre 21h e 24h de SP do último dia do mês, a Vercel em UTC já
// virou o mês/ano seguinte e a projeção do mês corrente some (ou o extrato de
// dezembro ganha o ano errado).

test("mês corrente da projeção sai do fuso America/Sao_Paulo, não do fuso local do runner", () => {
  // 2026-10-01T01:30:00Z = 30/09/2026 22h30 em São Paulo. Em UTC já é 01/10.
  const hoje = new Date("2026-10-01T01:30:00Z");

  const setembro = montarContexto(TRANSACOES, "2026-09", hoje);
  assert.equal(
    typeof setembro.projecao_fechamento,
    "number",
    "30/09 22h30 em SP ainda é setembro: a projeção do mês corrente não pode ser null",
  );
  // dia de hoje em SP = 30 e diasNoMes(setembro) = 30; saídas de 09 = 459200
  // => projecaoFechamento = round(459200 / 30 * 30) = 459200. Pelo fuso local
  // (UTC, dia 01 de outubro) o dia e o mês estariam errados.
  assert.equal(setembro.projecao_fechamento, 459200);

  const outubro = montarContexto(TRANSACOES, "2026-10", hoje);
  assert.equal(
    outubro.projecao_fechamento,
    null,
    "outubro ainda não começou em SP (é 30/09): mês não corrente, projeção null",
  );
});

test("ano de referência do extrato PDF sai do fuso America/Sao_Paulo", async () => {
  // anoReferenciaPdf é a função pura exportada de leitura-arquivo.ts: o resto de
  // lerArquivoImportacao toca File e pdfjs e não roda no test runner. Import
  // dinâmico de propósito — assim a suíte de montarContexto ainda mostra o
  // próprio vermelho mesmo quando o export ainda não existe no código antigo.
  const { anoReferenciaPdf } = await import("../../src/lib/leitura-arquivo.ts");
  // 2027-01-01T01:00:00Z = 31/12/2026 22h em São Paulo: o extrato de dezembro
  // tem de receber 2026, não 2027.
  assert.equal(anoReferenciaPdf(new Date("2027-01-01T01:00:00Z")), 2026);
  // Instante trivial, longe da virada: ano inalterado.
  assert.equal(anoReferenciaPdf(new Date("2026-06-15T12:00:00Z")), 2026);
});
