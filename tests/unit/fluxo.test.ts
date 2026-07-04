import { test } from "node:test";
import assert from "node:assert/strict";
import { agregarFluxoMensal, detectarAnomalia } from "../../src/lib/fluxo.ts";

const parcelas = [
  { valor: 10000, data_competencia: "2026-01-15", tipo: "DESPESA" as const },
  { valor: 5000, data_competencia: "2026-01-20", tipo: "DESPESA" as const },
  { valor: 30000, data_competencia: "2026-01-05", tipo: "RECEITA" as const },
  { valor: 8000, data_competencia: "2026-02-10", tipo: "DESPESA" as const },
  { valor: 30000, data_competencia: "2026-03-05", tipo: "RECEITA" as const },
];

test("agregarFluxoMensal: agrupa por mês, ordena e acumula", () => {
  const pontos = agregarFluxoMensal(parcelas);
  assert.equal(pontos.length, 3);
  assert.deepEqual(pontos[0], {
    mes: "2026-01", entradas: 30000, saidas: 15000, saldo: 15000, acumulado: 15000,
  });
  assert.deepEqual(pontos[1], {
    mes: "2026-02", entradas: 0, saidas: 8000, saldo: -8000, acumulado: 7000,
  });
  assert.equal(pontos[2].acumulado, 37000);
});

test("agregarFluxoMensal: vazio devolve vazio", () => {
  assert.deepEqual(agregarFluxoMensal([]), []);
});

test("detectarAnomalia: último mês com saídas > 1.5x da média histórica", () => {
  const pontos = agregarFluxoMensal([
    { valor: 10000, data_competencia: "2026-01-10", tipo: "DESPESA" as const },
    { valor: 12000, data_competencia: "2026-02-10", tipo: "DESPESA" as const },
    { valor: 40000, data_competencia: "2026-03-10", tipo: "DESPESA" as const },
  ]);
  const anomalia = detectarAnomalia(pontos);
  assert.ok(anomalia);
  assert.equal(anomalia.mes, "2026-03");
  assert.equal(anomalia.saidas, 40000);
  assert.equal(anomalia.mediaAnterior, 11000);
});

test("detectarAnomalia: fluxo estável ou histórico curto => null", () => {
  const estavel = agregarFluxoMensal([
    { valor: 10000, data_competencia: "2026-01-10", tipo: "DESPESA" as const },
    { valor: 11000, data_competencia: "2026-02-10", tipo: "DESPESA" as const },
    { valor: 12000, data_competencia: "2026-03-10", tipo: "DESPESA" as const },
  ]);
  assert.equal(detectarAnomalia(estavel), null);
  const curto = agregarFluxoMensal([
    { valor: 10000, data_competencia: "2026-01-10", tipo: "DESPESA" as const },
    { valor: 99000, data_competencia: "2026-02-10", tipo: "DESPESA" as const },
  ]);
  assert.equal(detectarAnomalia(curto), null);
});
