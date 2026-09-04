import { test, mock, afterEach } from "node:test";
import assert from "node:assert/strict";
import { log } from "../../src/lib/log.ts";

// O adapter não é um wrapper burro do console: `aviso` cala em produção e
// `erro` não. Sem teste, a distinção some no primeiro refactor e o usuário
// final passa a ver recado de migration no console do navegador.

const AMBIENTE_ORIGINAL = process.env.NODE_ENV;

function definirAmbiente(valor: string | undefined) {
  // NODE_ENV é readonly no tipo, mas é escrita comum em teste.
  (process.env as Record<string, string | undefined>).NODE_ENV = valor;
}

afterEach(() => {
  definirAmbiente(AMBIENTE_ORIGINAL);
  mock.restoreAll();
});

test("erro sai em desenvolvimento", () => {
  definirAmbiente("development");
  const espiao = mock.method(console, "error", () => {});
  log.erro("quebrou");
  assert.equal(espiao.mock.callCount(), 1);
  assert.deepEqual(espiao.mock.calls[0].arguments, ["quebrou"]);
});

test("erro sai TAMBÉM em produção — é o que sobra para diagnosticar", () => {
  definirAmbiente("production");
  const espiao = mock.method(console, "error", () => {});
  log.erro("quebrou em prod");
  assert.equal(espiao.mock.callCount(), 1);
});

test("aviso sai em desenvolvimento", () => {
  definirAmbiente("development");
  const espiao = mock.method(console, "warn", () => {});
  log.aviso("aplique a migration 0015");
  assert.equal(espiao.mock.callCount(), 1);
});

test("aviso CALA em produção — não é recado para o usuário final", () => {
  definirAmbiente("production");
  const espiao = mock.method(console, "warn", () => {});
  log.aviso("aplique a migration 0015");
  assert.equal(espiao.mock.callCount(), 0);
});

test("ambiente indefinido conta como desenvolvimento", () => {
  // Só "production" cala; qualquer outro valor (test, undefined) fala.
  definirAmbiente(undefined);
  const espiao = mock.method(console, "warn", () => {});
  log.aviso("visível");
  assert.equal(espiao.mock.callCount(), 1);
});

test("sem causa, nada de argumento vazio pendurado", () => {
  definirAmbiente("development");
  const espiao = mock.method(console, "error", () => {});
  log.erro("só a mensagem");
  assert.deepEqual(espiao.mock.calls[0].arguments, ["só a mensagem"]);
});

test("com causa, ela é repassada como segundo argumento", () => {
  definirAmbiente("development");
  const espiao = mock.method(console, "error", () => {});
  const causa = new Error("raiz");
  log.erro("falhou:", causa);
  assert.deepEqual(espiao.mock.calls[0].arguments, ["falhou:", causa]);
});

test("causa null é repassada — null é informação, undefined é ausência", () => {
  definirAmbiente("development");
  const espiao = mock.method(console, "error", () => {});
  log.erro("falhou:", null);
  assert.deepEqual(espiao.mock.calls[0].arguments, ["falhou:", null]);
});

test("o ambiente é lido a cada chamada, não na carga do módulo", () => {
  // Se fosse lido na importação, virar produção no meio da vida do processo
  // não teria efeito — e o teste anterior passaria por acidente de ordem.
  const espiao = mock.method(console, "warn", () => {});
  definirAmbiente("development");
  log.aviso("primeira");
  definirAmbiente("production");
  log.aviso("segunda");
  assert.equal(espiao.mock.callCount(), 1);
  assert.deepEqual(espiao.mock.calls[0].arguments, ["primeira"]);
});
