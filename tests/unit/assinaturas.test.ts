import { test } from "node:test";
import assert from "node:assert/strict";
import {
  custoMensalEquivalente,
  projecaoAnual,
  proximasCobrancas,
  resumirAssinaturas,
  rotuloPeriodicidade,
  type AssinaturaCalculavel,
} from "../../src/lib/assinaturas.ts";

test("equivalência mensal e projeção anual preservam centavos", () => {
  assert.equal(custoMensalEquivalente(2990, "MENSAL"), 2990);
  assert.equal(custoMensalEquivalente(12000, "ANUAL"), 1000);
  assert.equal(custoMensalEquivalente(10000, "TRIMESTRAL"), 3333);
  assert.equal(projecaoAnual(10000, "TRIMESTRAL"), 40000);
  assert.equal(projecaoAnual(18000, "SEMESTRAL"), 36000);
});

test("resumo considera somente assinaturas ativas", () => {
  const assinaturas: AssinaturaCalculavel[] = [
    { valor: 3000, periodicidade: "MENSAL", proxima_data: "2026-11-10", status: "ATIVA" },
    { valor: 12000, periodicidade: "ANUAL", proxima_data: "2026-12-10", status: "ATIVA" },
    { valor: 9000, periodicidade: "MENSAL", proxima_data: "2026-11-05", status: "PAUSADA" },
    { valor: 5000, periodicidade: "MENSAL", proxima_data: "2026-11-01", status: "CANCELADA" },
  ];

  assert.deepEqual(resumirAssinaturas(assinaturas), {
    quantidadeAtivas: 2,
    custoMensal: 4000,
    custoAnual: 48000,
  });
});

test("resumo arredonda o custo mensal uma vez depois de agregar o portfólio", () => {
  const assinaturas: AssinaturaCalculavel[] = [
    { valor: 10000, periodicidade: "TRIMESTRAL", proxima_data: "2026-11-10", status: "ATIVA" },
    { valor: 10000, periodicidade: "TRIMESTRAL", proxima_data: "2026-12-10", status: "ATIVA" },
  ];

  assert.equal(resumirAssinaturas(assinaturas).custoMensal, 6667);
});

test("próximas cobranças filtra status, ordena e respeita limite", () => {
  const assinaturas: AssinaturaCalculavel[] = [
    { valor: 100, periodicidade: "MENSAL", proxima_data: "2026-12-10", status: "ATIVA" },
    { valor: 100, periodicidade: "MENSAL", proxima_data: "2026-11-10", status: "PAUSADA" },
    { valor: 100, periodicidade: "MENSAL", proxima_data: "2026-10-10", status: "ATIVA" },
  ];

  assert.deepEqual(
    proximasCobrancas(assinaturas, 1).map((assinatura) => assinatura.proxima_data),
    ["2026-10-10"],
  );
});

test("rótulos cobrem todas as periodicidades públicas", () => {
  assert.equal(rotuloPeriodicidade("MENSAL"), "Mensal");
  assert.equal(rotuloPeriodicidade("TRIMESTRAL"), "Trimestral");
  assert.equal(rotuloPeriodicidade("SEMESTRAL"), "Semestral");
  assert.equal(rotuloPeriodicidade("ANUAL"), "Anual");
});
