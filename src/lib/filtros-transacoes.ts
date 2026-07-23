// Filtros da lista de transações: validação da querystring e aplicação no
// query builder do PostgREST. Puro e compartilhado — a página (servidor)
// monta a 1ª página e o "carregar mais" (cliente) continua o keyset com os
// MESMOS filtros; um helper só para os dois não divergirem.

export type FiltrosTransacoes = {
  /** uuid de categoria, ou "sem" para transações sem categoria. */
  categoria?: string;
  tipo?: "DESPESA" | "RECEITA";
  forma?: "CREDITO" | "DEBITO" | "PIX" | "DINHEIRO" | "BOLETO";
  /** ISO yyyy-mm-dd, inclusivo. */
  de?: string;
  ate?: string;
};

const TIPOS = new Set(["DESPESA", "RECEITA"]);
const FORMAS = new Set(["CREDITO", "DEBITO", "PIX", "DINHEIRO", "BOLETO"]);
const RE_DATA = /^\d{4}-\d{2}-\d{2}$/;
const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Querystring -> filtros válidos. Valor malformado é descartado (URL suja
 *  editada à mão não derruba a página; o filtro simplesmente não se aplica). */
export function filtrosDaQuery(sp: Record<string, string | string[] | undefined>): FiltrosTransacoes {
  const um = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const f: FiltrosTransacoes = {};
  const categoria = um(sp.categoria);
  if (categoria === "sem" || (categoria && RE_UUID.test(categoria))) f.categoria = categoria;
  const tipo = um(sp.tipo);
  if (tipo && TIPOS.has(tipo)) f.tipo = tipo as FiltrosTransacoes["tipo"];
  const forma = um(sp.forma);
  if (forma && FORMAS.has(forma)) f.forma = forma as FiltrosTransacoes["forma"];
  const de = um(sp.de);
  if (de && RE_DATA.test(de)) f.de = de;
  const ate = um(sp.ate);
  if (ate && RE_DATA.test(ate)) f.ate = ate;
  return f;
}

export function temFiltro(f: FiltrosTransacoes): boolean {
  return Boolean(f.categoria || f.tipo || f.forma || f.de || f.ate);
}

/** Interface mínima do builder (supabase-js satisfaz) — mantém o helper puro. */
export type ConsultaFiltravel<Q> = {
  eq(coluna: string, valor: string): Q;
  is(coluna: string, valor: null): Q;
  gte(coluna: string, valor: string): Q;
  lte(coluna: string, valor: string): Q;
};

export function aplicarFiltrosTransacoes<Q extends ConsultaFiltravel<Q>>(
  consulta: Q,
  f: FiltrosTransacoes,
): Q {
  let q = consulta;
  if (f.categoria === "sem") q = q.is("categoria_id", null);
  else if (f.categoria) q = q.eq("categoria_id", f.categoria);
  if (f.tipo) q = q.eq("tipo", f.tipo);
  if (f.forma) q = q.eq("forma_pagamento", f.forma);
  if (f.de) q = q.gte("data_compra", f.de);
  if (f.ate) q = q.lte("data_compra", f.ate);
  return q;
}

/** Filtros -> querystring (preserva filtros ao trocar período e vice-versa). */
export function queryDosFiltros(f: FiltrosTransacoes): string {
  const p = new URLSearchParams();
  if (f.categoria) p.set("categoria", f.categoria);
  if (f.tipo) p.set("tipo", f.tipo);
  if (f.forma) p.set("forma", f.forma);
  if (f.de) p.set("de", f.de);
  if (f.ate) p.set("ate", f.ate);
  const s = p.toString();
  return s ? `?${s}` : "";
}
