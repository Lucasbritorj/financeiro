import { test } from "node:test";
import assert from "node:assert/strict";
import {
  diasNoMes,
  ehMesValido,
  MESES_HISTORICO,
  montarCarteira,
  montarStats,
  normalizarTransacoes,
  projetarSaidas,
  resolverJanela,
  type LinhaTransacao,
} from "../../src/lib/dashboard-dados.ts";

// O dashboard não tinha nenhum teste: esta lógica decidia qual mês exibir e
// quanto projetar de gasto dentro de um Server Component de 178 linhas.

test("ehMesValido: só aceita yyyy-mm", () => {
  assert.equal(ehMesValido("2026-07"), true);
  assert.equal(ehMesValido("2026-7"), false);
  assert.equal(ehMesValido("2026-07-09"), false);
  assert.equal(ehMesValido(""), false);
  assert.equal(ehMesValido(undefined), false);
  assert.equal(ehMesValido(202607), false);
});

test("resolverJanela: query string válida tem prioridade sobre tudo", () => {
  const j = resolverJanela({
    mesQuery: "2026-03",
    mesComDados: "2026-07",
    mesCorrente: "2026-09",
  });
  assert.equal(j.mes, "2026-03");
  assert.equal(j.anterior, "2026-02");
  assert.equal(j.ehMesCorrente, false);
});

test("resolverJanela: query inválida cai no mês mais recente com dados", () => {
  // O ponto da regra: nunca abrir num mês vazio por acaso.
  const j = resolverJanela({
    mesQuery: "banana",
    mesComDados: "2026-07",
    mesCorrente: "2026-09",
  });
  assert.equal(j.mes, "2026-07");
});

test("resolverJanela: sem dados nenhum, cai no mês corrente", () => {
  const j = resolverJanela({ mesQuery: undefined, mesComDados: null, mesCorrente: "2026-09" });
  assert.equal(j.mes, "2026-09");
  assert.equal(j.ehMesCorrente, true);
});

test("resolverJanela: a janela cobre MESES_HISTORICO meses e termina no mês seguinte", () => {
  const j = resolverJanela({ mesQuery: "2026-09", mesComDados: null, mesCorrente: "2026-09" });
  assert.equal(j.inicioJanela, "2026-04-01"); // 6 meses contando setembro
  assert.equal(j.fimJanela, "2026-10-01"); // limite exclusivo
  assert.equal(MESES_HISTORICO, 6);
});

test("resolverJanela: janela atravessa a virada de ano", () => {
  const j = resolverJanela({ mesQuery: "2026-01", mesComDados: null, mesCorrente: "2026-01" });
  assert.equal(j.inicioJanela, "2025-08-01");
  assert.equal(j.fimJanela, "2026-02-01");
  assert.equal(j.anterior, "2025-12");
});

test("resolverJanela: não avança além do mês corrente", () => {
  const noCorrente = resolverJanela({
    mesQuery: "2026-09",
    mesComDados: "2026-07",
    mesCorrente: "2026-09",
  });
  assert.equal(noCorrente.proximoAtivo, false);

  const noPassado = resolverJanela({
    mesQuery: "2026-05",
    mesComDados: "2026-07",
    mesCorrente: "2026-09",
  });
  assert.equal(noPassado.proximoAtivo, true);
});

test("resolverJanela: lançamento futuro estica o teto além do mês corrente", () => {
  // Sem isso, uma compra parcelada lançada à frente ficaria inalcançável.
  const j = resolverJanela({
    mesQuery: "2026-09",
    mesComDados: "2026-12",
    mesCorrente: "2026-09",
  });
  assert.equal(j.proximoAtivo, true);
});

function linha(tipo: string, valor = 1000): LinhaTransacao {
  return {
    descricao: "x",
    valor_total: valor,
    tipo,
    data_compra: "2026-09-01",
    categorias: null,
  };
}

test("normalizarTransacoes: mantém DESPESA e RECEITA, descarta o resto", () => {
  const saida = normalizarTransacoes([
    linha("DESPESA"),
    linha("RECEITA"),
    linha("TRANSFERENCIA"),
    linha(""),
  ]);
  assert.deepEqual(
    saida.map((t) => t.tipo),
    ["DESPESA", "RECEITA"],
  );
});

test("normalizarTransacoes: renomeia categorias -> categoria e preserva null", () => {
  const comCategoria: LinhaTransacao = {
    ...linha("DESPESA"),
    categorias: { id: "c1", nome: "Mercado", cor: "#fff", orcamento_mensal: 50000 },
  };
  const [a, b] = normalizarTransacoes([comCategoria, linha("DESPESA")]);
  assert.equal(a.categoria?.nome, "Mercado");
  assert.equal(b.categoria, null);
  assert.deepEqual(normalizarTransacoes([]), []);
});

test("diasNoMes: meses de 30, 31 e fevereiro bissexto", () => {
  assert.equal(diasNoMes("2026-01"), 31);
  assert.equal(diasNoMes("2026-04"), 30);
  assert.equal(diasNoMes("2026-02"), 28);
  assert.equal(diasNoMes("2028-02"), 29); // bissexto
  assert.equal(diasNoMes("2100-02"), 28); // século não divisível por 400
});

test("projetarSaidas: mês fechado devolve o realizado, sem projetar", () => {
  assert.equal(
    projetarSaidas({ saidas: 123456, mes: "2026-05", ehMesCorrente: false, hojeISO: "2026-09-10" }),
    123456,
  );
});

test("projetarSaidas: mês corrente no último dia projeta o próprio realizado", () => {
  // Dia 30 de 30: não há mês restante para extrapolar.
  assert.equal(
    projetarSaidas({ saidas: 90000, mes: "2026-04", ehMesCorrente: true, hojeISO: "2026-04-30" }),
    90000,
  );
});

test("projetarSaidas: mês corrente no meio projeta acima do realizado", () => {
  const projetado = projetarSaidas({
    saidas: 50000,
    mes: "2026-04",
    ehMesCorrente: true,
    hojeISO: "2026-04-10",
  });
  assert.ok(projetado > 50000, `esperava projeção acima do realizado, veio ${projetado}`);
});

const RESUMO = { saldo: 25000, entradas: 500000, saidas: 475000 };

test("montarStats: saldo positivo ganha '+' e a cor de verde", () => {
  const [saldo] = montarStats({
    resumo: RESUMO,
    poupanca: 5,
    projecao: 475000,
    ehMesCorrente: true,
  });
  assert.ok(saldo.valor.startsWith("+"), `esperava '+', veio ${saldo.valor}`);
  assert.equal(saldo.cor, "var(--verde)");
});

test("montarStats: saldo negativo não ganha '+' e vira telha", () => {
  const [saldo] = montarStats({
    resumo: { ...RESUMO, saldo: -1 },
    poupanca: null,
    projecao: 0,
    ehMesCorrente: true,
  });
  assert.equal(saldo.valor.startsWith("+"), false);
  assert.equal(saldo.cor, "var(--telha)");
});

test("montarStats: saldo zero conta como positivo", () => {
  const [saldo] = montarStats({
    resumo: { ...RESUMO, saldo: 0 },
    poupanca: 0,
    projecao: 0,
    ehMesCorrente: false,
  });
  assert.ok(saldo.valor.startsWith("+"));
  assert.equal(saldo.cor, "var(--verde)");
});

test("montarStats: poupança nula vira travessão, não 0%", () => {
  const stats = montarStats({ resumo: RESUMO, poupanca: null, projecao: 1, ehMesCorrente: true });
  assert.equal(stats[1].valor, "—");
  const comZero = montarStats({ resumo: RESUMO, poupanca: 0, projecao: 1, ehMesCorrente: true });
  assert.equal(comZero[1].valor, "0%");
});

test("montarStats: o rótulo do 3º card muda com o mês", () => {
  const corrente = montarStats({ resumo: RESUMO, poupanca: 5, projecao: 1, ehMesCorrente: true });
  assert.equal(corrente[2].rotulo, "Projeção de fechamento");
  const passado = montarStats({ resumo: RESUMO, poupanca: 5, projecao: 1, ehMesCorrente: false });
  assert.equal(passado[2].rotulo, "Total de saídas");
});

test("montarCarteira: view vazia vira zeros, não NaN nem undefined", () => {
  assert.deepEqual(montarCarteira(null), {
    saldoCaixa: 0,
    entradas: 0,
    saidasAvista: 0,
    faturasPagas: 0,
    boletosPagos: 0,
  });
  assert.deepEqual(montarCarteira(undefined), montarCarteira(null));
  assert.deepEqual(montarCarteira({}), montarCarteira(null));
});

test("montarCarteira: null de coluna cai no default, e zero real é preservado", () => {
  const c = montarCarteira({ saldo_caixa: -5000, entradas: 0, saidas_avista: null });
  assert.equal(c.saldoCaixa, -5000); // negativo é dado válido
  assert.equal(c.entradas, 0);
  assert.equal(c.saidasAvista, 0);
});
