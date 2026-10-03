// CONTRATO
//   Garante: o hook bloqueia float monetário fora de money.ts e lib de data
//            sem America/Sao_Paulo, com exit 2, e libera as exceções com exit 0.
//   Espelha: o processo real recebendo tool_input sintético pelo stdin, sem
//            rede nem escrita em disco; os caminhos dos payloads são fictícios.
//   Vermelho: conversões monetárias e import temporal sem fuso explícito.
//   Limitação: JSON inválido mantém a falha aberta atual (exit 0).
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const hook = fileURLToPath(new URL("../../.codex/hooks/invariantes-guard.js", import.meta.url));

function verificarSaida(input: string, esperado: number): void {
  const resultado = spawnSync(process.execPath, [hook], {
    input,
    encoding: "utf8",
    timeout: 60_000,
  });

  assert.ifError(resultado.error);
  assert.equal(resultado.signal, null);
  assert.equal(resultado.status, esperado, resultado.stderr);
}

function verificarPayload(file_path: string, content: string, esperado: number): void {
  verificarSaida(JSON.stringify({ tool_input: { file_path, content } }), esperado);
}

test("invariantes-guard: bloqueia Math.round(valor * 100) fora de money.ts", () => {
  verificarPayload("C:/repo/src/app/x.tsx", "const centavos = Math.round(valor * 100);", 2);
});

test("invariantes-guard: bloqueia divisão por 100 com toFixed fora de money.ts", () => {
  verificarPayload("C:/repo/src/lib/outro.ts", "const reais = (centavos / 100).toFixed(2);", 2);
});

test("invariantes-guard: bloqueia date-fns sem America/Sao_Paulo", () => {
  verificarPayload("C:/repo/src/app/x.tsx", 'import { format } from "date-fns";', 2);
});

test("invariantes-guard: libera conversão monetária em src/lib/money.ts", () => {
  verificarPayload("C:/repo/src/lib/money.ts", "const centavos = Math.round(valor * 100);", 0);
});

test("invariantes-guard: libera conversão monetária em tests dentro de src", () => {
  verificarPayload("C:/repo/src/tests/x.ts", "const centavos = Math.round(valor * 100);", 0);
});

test("invariantes-guard: libera arquivo fora de src", () => {
  verificarPayload("C:/repo/scripts/x.ts", "const centavos = Math.round(valor * 100);", 0);
});

test("invariantes-guard: libera date-fns com America/Sao_Paulo no conteúdo", () => {
  verificarPayload(
    "C:/repo/src/app/x.tsx",
    'import { format } from "date-fns";\nconst fuso = "America/Sao_Paulo";',
    0,
  );
});

test("invariantes-guard: JSON inválido mantém falha aberta", () => {
  verificarSaida("{ JSON inválido", 0);
});
