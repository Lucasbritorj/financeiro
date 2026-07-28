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

// --- T-01: setUTCMonth transborda de mês quando o dia não existe no mês
// destino (29/30/31). Repro: hoje=2026-01-29, ritmo real leva a +1 mês;
// esperado 2026-02, o bug dá 2026-03 (fev/2026 não é bissexto, só tem 28 dias).

test("dataProjetada: hoje com dia 28/29/30/31 de janeiro não transborda pra março (T-01)", () => {
  const c = { valor_alvo: 100000, saldo_atual: 40000, data_alvo: null };
  // ritmo real = 180000/3meses = 60000/mês; falta = 60000; meses = 1.
  // O aporte é recente (20/jan) então cabe na janela dos 3 meses em
  // qualquer um dos "hoje" abaixo — isola o teste do bug de corte do
  // ritmoReal (coberto em teste separado).
  const movs: MovimentacaoCofrinho[] = [
    { valor: 180000, tipo: "APORTE", data: "2026-01-20" },
  ];
  assert.equal(dataProjetada(c, movs, "2026-01-28"), "2026-02"); // controle: não transborda mesmo hoje
  assert.equal(dataProjetada(c, movs, "2026-01-29"), "2026-02");
  assert.equal(dataProjetada(c, movs, "2026-01-30"), "2026-02");
  assert.equal(dataProjetada(c, movs, "2026-01-31"), "2026-02");
});

test("dataProjetada: virada de fevereiro bissexto — dia 29 cabe, 30/31 ainda transbordariam (T-01)", () => {
  const c = { valor_alvo: 100000, saldo_atual: 40000, data_alvo: null };
  const movs: MovimentacaoCofrinho[] = [
    { valor: 180000, tipo: "APORTE", data: "2028-01-20" },
  ];
  // 2028 é bissexto: fev tem 29 dias, então hoje=29/jan já não transbordava
  // nem com o bug; 30 e 31 transbordam pra março de qualquer forma.
  assert.equal(dataProjetada(c, movs, "2028-01-29"), "2028-02");
  assert.equal(dataProjetada(c, movs, "2028-01-30"), "2028-02");
  assert.equal(dataProjetada(c, movs, "2028-01-31"), "2028-02");
});

test("ritmoReal: corte de janela não transborda de mês quando hoje tem dia 31 (T-01)", () => {
  // hoje=31/mai, janela padrão de 3 meses: o corte correto cai por volta de
  // fev/mar. O bug do setUTCMonth transborda o corte pra 03/mar (fev/2026 só
  // tem 28 dias), excluindo indevidamente um aporte de 02/mar que devia
  // entrar na janela.
  const movs: MovimentacaoCofrinho[] = [
    { valor: 30000, tipo: "APORTE", data: "2026-03-02" },
  ];
  assert.equal(ritmoReal(movs, "2026-05-31"), 10000); // 30000 / 3
});
