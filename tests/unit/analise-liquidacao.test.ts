import { test } from "node:test";
import assert from "node:assert/strict";
import { analisarFinancas } from "../../src/lib/analise.ts";
import type { TransacaoInsight } from "../../src/lib/insights.ts";

test("liquidações não criam falsas assinaturas ou tendências de categoria", () => {
  const args = { mesISO: "2026-10", hojeISO: "2026-10-16", formatar: String, limite: 50 };
  const compra: TransacaoInsight = { descricao: "Mercado", valor_total: 10000, tipo: "DESPESA", data_compra: "2026-10-01", natureza: "CONSUMO", categoria: null };
  const liquidacoes: TransacaoInsight[] = ["2026-08", "2026-09", "2026-10"].map((mes) => ({ ...compra, descricao: "Pagamento fatura", data_compra: `${mes}-02`, natureza: "LIQUIDACAO_FATURA" }));
  assert.deepEqual(analisarFinancas([compra, ...liquidacoes], args), analisarFinancas([compra], args));
});
