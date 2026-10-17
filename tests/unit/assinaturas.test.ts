import { test } from "node:test";
import assert from "node:assert/strict";
import {
  custoMensalEquivalente,
  impactoPorCartao,
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

test("impacto por cartão agrega somente ativas e arredonda depois de agregar", () => {
  const assinaturas = [
    { descricao: "Beta", valor: 10000, periodicidade: "TRIMESTRAL", proxima_data: "2026-11-10", status: "ATIVA", cartao_id: "card-1" },
    { descricao: "Alfa", valor: 10000, periodicidade: "TRIMESTRAL", proxima_data: "2026-11-11", status: "ATIVA", cartao_id: "card-1" },
    { descricao: "Pausada", valor: 90000, periodicidade: "MENSAL", proxima_data: "2026-11-12", status: "PAUSADA", cartao_id: "card-1" },
    { descricao: "Sem cartão", valor: 10000, periodicidade: "ANUAL", proxima_data: "2026-11-13", status: "ATIVA", cartao_id: null },
    { descricao: "Legado", valor: 10000, periodicidade: "ANUAL", proxima_data: "2026-11-14", status: "ATIVA", cartao_id: "card-removido" },
  ] as const;

  assert.deepEqual(
    impactoPorCartao(assinaturas, [
      { id: "card-1", nome: "Nubank" },
      { id: "card-vazio", nome: "Sem uso" },
    ]),
    [
      {
        cartaoId: "card-1",
        nomeCartao: "Nubank",
        quantidadeAtivas: 2,
        custoMensal: 6667,
        custoAnual: 80000,
        participacaoPercentual: 800,
        principaisAssinaturas: [
          { descricao: "Alfa", custoAnual: 40000 },
          { descricao: "Beta", custoAnual: 40000 },
        ],
      },
      {
        cartaoId: null,
        nomeCartao: "Sem cartão",
        quantidadeAtivas: 1,
        custoMensal: 833,
        custoAnual: 10000,
        participacaoPercentual: 100,
        principaisAssinaturas: [{ descricao: "Sem cartão", custoAnual: 10000 }],
      },
      {
        cartaoId: "card-removido",
        nomeCartao: "Cartão removido",
        quantidadeAtivas: 1,
        custoMensal: 833,
        custoAnual: 10000,
        participacaoPercentual: 100,
        principaisAssinaturas: [{ descricao: "Legado", custoAnual: 10000 }],
      },
    ],
  );
});

test("impacto por cartão distribui décimos pelo maior resto com desempate estável", () => {
  const assinaturas = ["card-1", "card-2", "card-3"].map((cartao_id, indice) => ({
    descricao: `Assinatura ${indice + 1}`,
    valor: 1000,
    periodicidade: "ANUAL" as const,
    proxima_data: "2026-11-10",
    status: "ATIVA" as const,
    cartao_id,
  }));
  const grupos = impactoPorCartao(
    assinaturas,
    assinaturas.map((assinatura) => ({ id: assinatura.cartao_id, nome: assinatura.cartao_id })),
  );

  assert.deepEqual(
    grupos.map((grupo) => grupo.participacaoPercentual),
    [334, 333, 333],
  );
  assert.equal(
    grupos.reduce((total, grupo) => total + grupo.participacaoPercentual, 0),
    1000,
  );
});

test("impacto por cartão fecha sete grupos iguais em mil décimos", () => {
  const assinaturas = Array.from({ length: 7 }, (_, indice) => ({
    descricao: `Assinatura ${indice + 1}`,
    valor: 1000,
    periodicidade: "ANUAL" as const,
    proxima_data: "2026-11-10",
    status: "ATIVA" as const,
    cartao_id: `card-${indice + 1}`,
  }));
  const grupos = impactoPorCartao(
    assinaturas,
    assinaturas.map((assinatura) => ({ id: assinatura.cartao_id, nome: assinatura.cartao_id })),
  );

  assert.equal(
    grupos.reduce((total, grupo) => total + grupo.participacaoPercentual, 0),
    1000,
  );
});

test("impacto por cartão preserva totais do resumo entre cartões e sem cartão", () => {
  const assinaturas = [
    { descricao: "Mensal", valor: 3000, periodicidade: "MENSAL", proxima_data: "2026-11-10", status: "ATIVA", cartao_id: "card-1" },
    { descricao: "Anual", valor: 12000, periodicidade: "ANUAL", proxima_data: "2026-11-11", status: "ATIVA", cartao_id: "card-2" },
    { descricao: "Sem cartão", valor: 1000, periodicidade: "TRIMESTRAL", proxima_data: "2026-11-12", status: "ATIVA", cartao_id: null },
  ] as const;
  const grupos = impactoPorCartao(assinaturas, [
    { id: "card-1", nome: "Nubank" },
    { id: "card-2", nome: "Inter" },
  ]);

  assert.equal(
    grupos.reduce((total, grupo) => total + grupo.custoAnual, 0),
    resumirAssinaturas(assinaturas).custoAnual,
  );
  assert.equal(
    grupos.reduce((total, grupo) => total + grupo.participacaoPercentual, 0),
    1000,
  );
});

test("impacto por cartão exclui canceladas e pausadas de todos os grupos", () => {
  const assinaturas = [
    { descricao: "Ativa", valor: 1000, periodicidade: "MENSAL", proxima_data: "2026-11-10", status: "ATIVA", cartao_id: "card-ativa" },
    { descricao: "Pausada", valor: 2000, periodicidade: "MENSAL", proxima_data: "2026-11-11", status: "PAUSADA", cartao_id: "card-pausada" },
    { descricao: "Cancelada", valor: 3000, periodicidade: "MENSAL", proxima_data: "2026-11-12", status: "CANCELADA", cartao_id: null },
  ] as const;
  const grupos = impactoPorCartao(assinaturas, [
    { id: "card-ativa", nome: "Ativo" },
    { id: "card-pausada", nome: "Pausado" },
  ]);

  assert.deepEqual(grupos.map((grupo) => grupo.cartaoId), ["card-ativa"]);
  assert.deepEqual(
    grupos.flatMap((grupo) => grupo.principaisAssinaturas.map((assinatura) => assinatura.descricao)),
    ["Ativa"],
  );
});

test("impacto por cartão limita o ranking a três e ordena empates por descrição", () => {
  const assinaturas = ["Delta", "Beta", "Alfa", "Gama"].map((descricao) => ({
    descricao,
    valor: descricao === "Gama" ? 2000 : 1000,
    periodicidade: "MENSAL" as const,
    proxima_data: "2026-11-10",
    status: "ATIVA" as const,
    cartao_id: "card-1",
  }));

  assert.deepEqual(
    impactoPorCartao(assinaturas, [{ id: "card-1", nome: "Nubank" }])[0]
      ?.principaisAssinaturas.map((assinatura) => assinatura.descricao),
    ["Gama", "Alfa", "Beta"],
  );
  assert.equal(
    impactoPorCartao(assinaturas, [{ id: "card-1", nome: "Nubank" }])[0]?.custoAnual,
    60000,
  );
  assert.deepEqual(impactoPorCartao([], [{ id: "card-1", nome: "Nubank" }]), []);
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
