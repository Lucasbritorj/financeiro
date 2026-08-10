import { test } from "node:test";
import assert from "node:assert/strict";
import {
  filtrosDaQuery,
  aplicarFiltrosTransacoes,
  queryDosFiltros,
  temFiltro,
  type ConsultaFiltravel,
} from "../../src/lib/filtros-transacoes.ts";

const UUID = "123e4567-e89b-42d3-a456-426614174000";

// Builder falso que registra as chamadas — valida a tradução p/ PostgREST.
// Interface (não type alias): TS permite autorreferência em extends.
interface BuilderFalso extends ConsultaFiltravel<BuilderFalso> {
  chamadas: string[];
}
function builderFalso(): BuilderFalso {
  const chamadas: string[] = [];
  const q: BuilderFalso = {
    chamadas,
    eq(c, v) {
      chamadas.push(`eq:${c}=${v}`);
      return q;
    },
    is(c, v) {
      chamadas.push(`is:${c}=${v}`);
      return q;
    },
    gte(c, v) {
      chamadas.push(`gte:${c}=${v}`);
      return q;
    },
    lte(c, v) {
      chamadas.push(`lte:${c}=${v}`);
      return q;
    },
  };
  return q;
}

test("filtrosDaQuery: aceita válidos, descarta malformados", () => {
  const f = filtrosDaQuery({
    categoria: UUID,
    tipo: "DESPESA",
    forma: "PIX",
    de: "2026-07-01",
    ate: "2026-07-31",
  });
  assert.deepEqual(f, {
    categoria: UUID,
    tipo: "DESPESA",
    forma: "PIX",
    de: "2026-07-01",
    ate: "2026-07-31",
  });
  assert.deepEqual(
    filtrosDaQuery({ categoria: "'; drop--", tipo: "X", forma: "CHEQUE", de: "07/01" }),
    {},
  );
  assert.deepEqual(filtrosDaQuery({ categoria: "sem" }), { categoria: "sem" });
  assert.equal(temFiltro({}), false);
  assert.equal(temFiltro({ tipo: "RECEITA" }), true);
});

test("aplicarFiltrosTransacoes: traduz cada filtro para o builder", () => {
  const q = builderFalso();
  aplicarFiltrosTransacoes(q, {
    categoria: "sem",
    tipo: "DESPESA",
    forma: "PIX",
    de: "2026-07-01",
    ate: "2026-07-31",
  });
  assert.deepEqual(q.chamadas, [
    "is:categoria_id=null",
    "eq:tipo=DESPESA",
    "eq:forma_pagamento=PIX",
    "gte:data_compra=2026-07-01",
    "lte:data_compra=2026-07-31",
  ]);
  const q2 = builderFalso();
  aplicarFiltrosTransacoes(q2, { categoria: UUID });
  assert.deepEqual(q2.chamadas, [`eq:categoria_id=${UUID}`]);
});

test("queryDosFiltros: ida e volta com filtrosDaQuery", () => {
  const f = { categoria: "sem" as const, forma: "PIX" as const, de: "2026-01-01" };
  const qs = queryDosFiltros(f);
  const sp = Object.fromEntries(new URLSearchParams(qs.slice(1)));
  assert.deepEqual(filtrosDaQuery(sp), f);
  assert.equal(queryDosFiltros({}), "");
});
