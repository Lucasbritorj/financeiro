import { test } from "node:test";
import assert from "node:assert/strict";
import {
  extensaoDoArquivo,
  origemPorExtensao,
  calcularResumoRevisao,
  type LinhaRevisao,
} from "../../src/lib/importacao-preview.ts";

test("extensaoDoArquivo: extrai em minúsculas, ignorando maiúsculas do nome original", () => {
  assert.equal(extensaoDoArquivo("extrato.CSV"), "csv");
  assert.equal(extensaoDoArquivo("Extrato Nubank.OFX"), "ofx");
});

test("extensaoDoArquivo: arquivo com múltiplos pontos usa a última extensão", () => {
  assert.equal(extensaoDoArquivo("extrato.2026.01.pdf"), "pdf");
});

test("extensaoDoArquivo: sem ponto no nome devolve string vazia", () => {
  assert.equal(extensaoDoArquivo("extrato"), "");
});

test("origemPorExtensao: ofx e ofc mantêm o rótulo específico (não colapsam em um só)", () => {
  assert.equal(origemPorExtensao("ofx"), "OFX");
  assert.equal(origemPorExtensao("ofc"), "OFC");
});

test("origemPorExtensao: xlsx e pdf têm rótulo próprio", () => {
  assert.equal(origemPorExtensao("xlsx"), "XLSX");
  assert.equal(origemPorExtensao("pdf"), "PDF");
});

test("origemPorExtensao: extensão desconhecida cai em CSV (mesmo comportamento de hoje)", () => {
  assert.equal(origemPorExtensao("txt"), "CSV");
  assert.equal(origemPorExtensao(""), "CSV");
});

function linha(over: Partial<LinhaRevisao>): LinhaRevisao {
  return {
    id: "id-1",
    data: "2026-01-10",
    valor: -1000,
    descricao: "compra",
    categoria_sugerida: null,
    duplicada: false,
    ignorar: false,
    classificacao: "NOVO",
    ...over,
  };
}

test("calcularResumoRevisao: tudo NOVO e não ignorado conta pra importar", () => {
  const r = calcularResumoRevisao([linha({ id: "1" }), linha({ id: "2" })]);
  assert.deepEqual(r, { total: 2, aImportar: 2, novos: 2, duplicadas: 0, ambiguos: 0 });
});

test("calcularResumoRevisao: DUPLICADO nunca conta em aImportar, mesmo desmarcado (0020)", () => {
  // A regra real vive em confirmar_importacao no banco — este contador só
  // espelha o servidor. Se um DUPLICADO entrasse aqui, a UI prometeria uma
  // importação que o banco vai recusar.
  const r = calcularResumoRevisao([
    linha({ id: "1", classificacao: "DUPLICADO", ignorar: false }),
  ]);
  assert.equal(r.aImportar, 0);
  assert.equal(r.duplicadas, 1);
});

test("calcularResumoRevisao: linha ignorada não conta em aImportar mesmo sendo NOVO", () => {
  const r = calcularResumoRevisao([linha({ id: "1", classificacao: "NOVO", ignorar: true })]);
  assert.equal(r.aImportar, 0);
  assert.equal(r.novos, 1); // "novos" é contagem bruta, não depende de ignorar
});

test("calcularResumoRevisao: AMBIGUO não ignorado conta em aImportar (exige opt-in, que aqui é 'não marcou pra ignorar')", () => {
  const r = calcularResumoRevisao([linha({ id: "1", classificacao: "AMBIGUO", ignorar: false })]);
  assert.equal(r.aImportar, 1);
  assert.equal(r.ambiguos, 1);
});

test("calcularResumoRevisao: lista vazia devolve zeros, não erro", () => {
  assert.deepEqual(calcularResumoRevisao([]), {
    total: 0,
    aImportar: 0,
    novos: 0,
    duplicadas: 0,
    ambiguos: 0,
  });
});
