import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// Vitest cobre SÓ o que o runner nativo não alcança: componente React.
//
// `node --test` continua sendo o runner de tudo em tests/unit — 416 testes de
// lógica pura que rodam sem transform nenhum, porque o Node 24 faz
// type-stripping de .ts sozinho. O que ele não faz é transformar JSX, e é
// por isso que .tsx nunca entrou na suíte (ver o cabeçalho de
// src/lib/importacao-preview.ts). Vitest entra exatamente nessa lacuna.
//
// `include` é restrito de propósito: sem ele o Vitest tentaria rodar também
// os testes de node:test, que usam outra API de asserção.
export default defineConfig({
  plugins: [react()],
  resolve: {
    // Espelha o path alias do tsconfig.json.
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "jsdom",
    include: ["tests/componentes/**/*.test.tsx"],
    setupFiles: ["tests/componentes/setup.ts"],
    // Sem globais: cada teste importa test/expect, como o resto do projeto
    // importa de node:test.
    globals: false,
    restoreMocks: true,
    // O pool "forks" (default) não sobe worker neste Windows — o processo
    // fica esperando resposta e estoura em timeout sem rodar teste nenhum.
    // "threads" usa worker_threads e arranca normalmente.
    pool: "threads",
  },
});
