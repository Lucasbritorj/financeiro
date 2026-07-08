import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mesesAte,
  ritmoNecessario,
  ritmoReal,
  statusCofrinho,
  dataProjetada,
  progressoPct,
  type MovimentacaoCofrinho,
} from "../../src/lib/cofrinhos.ts";

const HOJE = "2026-07-08";

test("mesesAte conta meses de calendário, mínimo 1", () => {
  assert.equal(mesesAte(HOJE, "2026-12-31"), 5);
  assert.equal(mesesAte(HOJE, "2027-02-01"), 7);
  assert.equal(mesesAte(HOJE, "2026-07-20"), 1);
});

test("ritmoNecessario: (alvo - saldo) / meses, teto pra cima", () => {
  const c = { valor_alvo: 1500000, saldo_atual: 320000, data_alvo: "2026-12-01" };
  assert.equal(ritmoNecessario(c, HOJE), 236000); // 1.180.000 / 5
  assert.equal(ritmoNecessario({ ...c, data_alvo: null }, HOJE), null);
  assert.equal(ritmoNecessario({ ...c, saldo_atual: 1500000 }, HOJE), 0);
});

test("ritmoReal: média líquida da janela, resgate abate", () => {
  const movs: MovimentacaoCofrinho[] = [
    { valor: 50000, tipo: "APORTE", data: "2026-06-10" },
    { valor: 50000, tipo: "APORTE", data: "2026-05-10" },
    { valor: 20000, tipo: "RESGATE", data: "2026-06-20" },
    { valor: 99999, tipo: "APORTE", data: "2026-01-10" }, // fora da janela
  ];
  assert.equal(ritmoReal(movs, HOJE), Math.round(80000 / 3));
});

test("statusCofrinho cobre os quatro estados", () => {
  const c = { valor_alvo: 100000, saldo_atual: 40000, data_alvo: "2026-12-01" };
  // necessário = 60000/5 = 12000/mês
  const aporte = (v: number): MovimentacaoCofrinho[] => [
    { valor: v * 3, tipo: "APORTE", data: "2026-06-10" },
  ];
  assert.equal(statusCofrinho(c, aporte(12000), HOJE), "no_ritmo");
  assert.equal(statusCofrinho(c, aporte(20000), HOJE), "adiantado");
  assert.equal(statusCofrinho(c, aporte(5000), HOJE), "atrasado");
  assert.equal(statusCofrinho({ ...c, saldo_atual: 100000 }, [], HOJE), "completo");
  assert.equal(statusCofrinho({ ...c, data_alvo: null }, [], HOJE), "sem_meta");
});

test("dataProjetada pelo ritmo real; null sem ritmo", () => {
  const c = { valor_alvo: 100000, saldo_atual: 40000, data_alvo: null };
  const movs: MovimentacaoCofrinho[] = [
    { valor: 36000, tipo: "APORTE", data: "2026-06-10" },
  ]; // ritmo 12000/mês -> 60000 faltantes = 5 meses
  assert.equal(dataProjetada(c, movs, HOJE), "2026-12");
  assert.equal(dataProjetada(c, [], HOJE), null);
  assert.equal(dataProjetada({ ...c, saldo_atual: 100000 }, [], HOJE), "2026-07");
});

test("progressoPct clampa em 100", () => {
  assert.equal(progressoPct({ valor_alvo: 100000, saldo_atual: 69000, data_alvo: null }), 69);
  assert.equal(progressoPct({ valor_alvo: 100000, saldo_atual: 150000, data_alvo: null }), 100);
});
