import { createRequire } from "node:module";
import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const require = createRequire(import.meta.url);
const quality = require("./eslint-rules/index.cjs");

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    ".consolidacao/**",
  ]),

  // As regras locais são um plugin CommonJS: require() ali é obrigatório,
  // não é dívida de módulo.
  {
    files: ["eslint-rules/**/*.cjs"],
    rules: { "@typescript-eslint/no-require-imports": "off" },
  },

  // --- Quality gates ---------------------------------------------------
  // Regras locais em ./eslint-rules. Primeira rodada inteira em "warn":
  // medir a dívida antes de promover para "error".
  {
    files: ["src/**/*.{ts,tsx}"],
    plugins: { quality },
    rules: {
      // database.types.ts é gerado pelo Supabase CLI, não é código autoral.
      "quality/max-lines": [
        "warn",
        { max: 350, ignore: ["src/lib/database.types.ts"] },
      ],
      // Existe adapter (src/lib/log.ts) e a dívida está zerada, então a regra
      // pode barrar de verdade: console novo não entra.
      "quality/no-direct-console": ["error", { logger: "log de @/lib/log" }],

      // Budgets de complexidade — medir antes de apertar.
      complexity: ["warn", 12],
      "max-depth": ["warn", 4],
      "max-params": ["warn", 4],
      "max-nested-callbacks": ["warn", 3],
      "max-lines-per-function": [
        "warn",
        { max: 150, skipBlankLines: true, skipComments: true },
      ],

      // Higiene: erro desde já, dívida atual é zero.
      "no-var": "error",
      "prefer-const": "error",
    },
  },

  // O adapter de log É o wrapper do console — a regra não se aplica a ele.
  {
    files: ["src/lib/log.ts"],
    rules: { "quality/no-direct-console": "off" },
  },

  // Boundary server-only. src/lib/supabase/server.ts usa next/headers e só
  // roda em Server Component / Route Handler. Importá-lo de um componente
  // client quebra em runtime. Dívida atual: 0 — por isso já entra como erro.
  //
  // NOTA: a regra quality/no-direct-data-access do toolkit NÃO foi ativada.
  // Ela bloqueia createClient() em app/ e components/, que é justamente o
  // padrão canônico do Supabase para o App Router (26 arquivos aqui). Ativá-la
  // exigiria criar uma camada de repository que este projeto não tem.
  {
    files: ["src/components/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@/lib/supabase/server",
              message:
                "server.ts é server-only (next/headers). Em componente client use @/lib/supabase/client, ou receba os dados por prop de um Server Component.",
            },
          ],
        },
      ],
    },
  },

  // Testes: o tamanho e a complexidade de um teste não dizem nada sobre a
  // fatoração do código que ele exercita.
  {
    files: ["tests/**/*.{ts,tsx,mjs}", "**/*.{test,spec}.{ts,tsx}"],
    rules: {
      "quality/max-lines": "off",
      "max-lines-per-function": "off",
      "max-nested-callbacks": "off",
      "max-statements": "off",
      complexity: "off",
    },
  },
]);

export default eslintConfig;
