import { test } from "node:test";
import assert from "node:assert/strict";
import { lerTodasPaginas } from "../../src/lib/leitura-paginada.ts";

test("percorre mais de mil registros, inclusive servidor com teto menor que a página", async () => {
  const registros = Array.from({ length: 1203 }, (_, id) => ({ id: String(id).padStart(4, "0") }));
  const resultado = await lerTodasPaginas(async (cursor, tamanho) => ({
    data: registros.filter((r) => cursor === null || r.id > cursor).slice(0, Math.min(tamanho, 200)), error: null,
  }));
  assert.deepEqual(resultado, registros);
});
test("erro intermediário não devolve resultado parcial", async () => {
  await assert.rejects(lerTodasPaginas(async (cursor) => cursor === null
    ? { data: [{ id: "1" }], error: null }
    : { data: null, error: { message: "Sessão expirada" } }), /Sessão expirada/);
});
test("exclusão antes do cursor não pula o próximo lançamento", async () => {
  let registros = [{ id: "10" }, { id: "20" }, { id: "30" }, { id: "40" }];
  let chamadas = 0;
  const resultado = await lerTodasPaginas(async (cursor) => {
    if (chamadas++ === 1) registros = registros.filter((r) => r.id !== "10");
    return { data: registros.filter((r) => cursor === null || r.id > cursor).slice(0, 2), error: null };
  });
  assert.deepEqual(resultado.map((r) => r.id), ["10", "20", "30", "40"]);
});
test("lista vazia termina sem dados inventados", async () => {
  assert.deepEqual(await lerTodasPaginas(async () => ({ data: [], error: null })), []);
});
test("inserção antes da página não duplica um lançamento já lido", async () => {
  let registros = [{ id: "10" }, { id: "20" }, { id: "30" }, { id: "40" }];
  let chamadas = 0;
  const resultado = await lerTodasPaginas(async (cursor) => {
    if (chamadas++ === 1) registros = [...registros, { id: "15" }].sort((a,b) => a.id.localeCompare(b.id));
    return { data: registros.filter((r) => cursor === null || r.id > cursor).slice(0, 2), error: null };
  });
  assert.deepEqual(resultado.map((r) => r.id), ["10", "20", "30", "40"]);
});
