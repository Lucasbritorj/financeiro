import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { lerCiYml, lerServicosDoCi } from "../gate/_ci-yml.ts";
import {
  DIVERGENCIA_DECLARADA,
  FONTE_PRODUCAO,
  MAJOR_PRODUCAO,
  imagemDoRunLocal,
  majorDaImagem,
} from "../gate/postgres.ts";

// CONTRATO
//   Garante  — que os dois lugares que rodam as migrações deste projeto
//              (.github/workflows/ci.yml e tests/sql/run_local.sh) fixam o
//              MESMO major de Postgres, e que a diferença entre esse major e o
//              de produção está declarada em tests/gate/postgres.ts.
//   Falha se — os dois arquivos divergirem entre si; a divergência com produção
//              existir sem declaração; ou a declaração sobreviver depois de a
//              divergência acabar.
//   Espelha  — o par (versão do CI, versão de produção), não a correção das
//              migrações em nenhuma das duas.
//   Vermelho — provado com ci.yml e run_local.sh sintéticos em cada regra.
//
// O que ele NÃO garante, e é a parte importante: que as migrações PASSAM no
// major declarado para produção. Isso exige Postgres real, e o único lugar que
// sobe um é o job `sql` do CI. Este gate mede a declaração, não a execução —
// e o motivo de ele existir assim é que a alternativa (trocar a imagem sem
// poder rodá-la) entrega risco sem evidência.

const CAMINHO_RUN_LOCAL = new URL("../sql/run_local.sh", import.meta.url);

/** As queixas do gate contra o trio (ci.yml, run_local.sh, declaração). */
function divergencias(
  imagemCi: string,
  imagemLocal: string,
  declarada: typeof DIVERGENCIA_DECLARADA,
  majorProducao: number,
): string[] {
  const queixas: string[] = [];

  const majorCi = majorDaImagem(imagemCi);
  const majorLocal = majorDaImagem(imagemLocal);

  if (majorCi === null) {
    queixas.push(
      `não sei ler o major de "${imagemCi}" (imagem do serviço no ci.yml). ` +
        `Este gate entende \`postgres:N\`, \`postgres:N.M\` e \`postgres:N-variante\`.`,
    );
  }
  if (majorLocal === null) {
    queixas.push(
      `não sei ler o major de "${imagemLocal}" (IMAGEM= em tests/sql/run_local.sh).`,
    );
  }
  if (majorCi === null || majorLocal === null) return queixas;

  if (majorCi !== majorLocal) {
    queixas.push(
      `o ci.yml roda os asserts em postgres ${majorCi} e tests/sql/run_local.sh ` +
        `em ${majorLocal}. São os dois lugares que aplicam as MESMAS migrações: ` +
        `divergindo, "verde local" e "verde no CI" deixam de ser a mesma ` +
        `afirmação, e a diferença aparece só quando um dos dois quebra.`,
    );
  }

  if (majorCi !== majorProducao) {
    if (!declarada) {
      queixas.push(
        `o CI roda postgres ${majorCi} e produção roda ${majorProducao}, e ` +
          `tests/gate/postgres.ts não declara essa divergência. Verde numa ` +
          `versão que não é a de produção é uma afirmação mais fraca do que ` +
          `parece — declare o motivo ou alinhe as versões.`,
      );
    } else if (
      declarada.majorCi !== majorCi ||
      declarada.majorProducao !== majorProducao
    ) {
      queixas.push(
        `tests/gate/postgres.ts declara a divergência ${declarada.majorCi} x ` +
          `${declarada.majorProducao}, e o disco tem ${majorCi} x ` +
          `${majorProducao}. Declaração que envelheceu é pior que divergência ` +
          `não declarada: faz o leitor confiar num texto que já não descreve ` +
          `o arquivo.`,
      );
    }
  } else if (declarada) {
    queixas.push(
      `CI e produção rodam postgres ${majorCi}, e tests/gate/postgres.ts ainda ` +
        `declara uma divergência aceita. A divergência acabou — apague a ` +
        `declaração, senão ela vira folclore que sobrevive ao fato.`,
    );
  }

  return queixas;
}

const IMAGEM_CI_REAL = (): string => {
  const servicos = lerServicosDoCi(lerCiYml(), "sql");
  const imagem = servicos.postgres;
  assert.ok(imagem, "o job `sql` não declara um serviço `postgres`");
  return imagem;
};

// ---------------------------------------------------------------- o gate real

test("suíte real: ci.yml e run_local.sh fixam o mesmo Postgres, e a divergência com produção está declarada", () => {
  const imagemLocal = imagemDoRunLocal(readFileSync(CAMINHO_RUN_LOCAL, "utf8"));

  assert.deepEqual(
    divergencias(IMAGEM_CI_REAL(), imagemLocal, DIVERGENCIA_DECLARADA, MAJOR_PRODUCAO),
    [],
    "a versão de Postgres saiu de sincronia. Conserte o ci.yml, o " +
      "tests/sql/run_local.sh ou a declaração em tests/gate/postgres.ts — os " +
      "três precisam contar a mesma história.",
  );
});

test("suíte real: a declaração de produção cita onde foi conferida", () => {
  assert.ok(FONTE_PRODUCAO.includes("0027"), "FONTE_PRODUCAO não cita a migração de origem");
  assert.ok(/\d{2}\/\d{2}\/\d{4}/.test(FONTE_PRODUCAO), "FONTE_PRODUCAO não é datada");
});

test("suíte real: enquanto houver divergência declarada, ela diz o que exige removê-la", () => {
  if (!DIVERGENCIA_DECLARADA) return;

  assert.ok(
    DIVERGENCIA_DECLARADA.oQueExigeRemover.includes("run_local.sh"),
    "a saída declarada não menciona o segundo lugar que fixa a imagem",
  );
  assert.ok(
    DIVERGENCIA_DECLARADA.motivo.length > 80,
    "motivo curto demais para ser um motivo — é uma etiqueta",
  );
});

const FIXTURE_16_VS_17 = {
  majorCi: 16,
  majorProducao: 17,
  motivo: "fixture de teste: declara 16 vs 17 para exercitar o ramo, nao o disco.",
  oQueExigeRemover: "run_local.sh e ci.yml",
} as const;

// -------------------------------------------------------------- as regras, RED

test("o gate não cobra nada quando CI, local e declaração contam a mesma história", () => {
  assert.deepEqual(
    divergencias("postgres:16-alpine", "postgres:16-alpine", FIXTURE_16_VS_17, 17),
    [],
  );
});

test("RED: ci.yml e run_local.sh em majors diferentes é queixa", () => {
  const queixas = divergencias(
    "postgres:17-alpine",
    "postgres:16-alpine",
    DIVERGENCIA_DECLARADA,
    17,
  );

  assert.ok(queixas.some((q) => /asserts em postgres 17 e tests\/sql\/run_local\.sh em 16/.test(q)));
});

test("RED: divergência com produção sem declaração é queixa", () => {
  const queixas = divergencias("postgres:16-alpine", "postgres:16-alpine", null, 17);

  assert.equal(queixas.length, 1);
  assert.match(queixas[0], /não declara essa divergência/);
});

test("RED: declaração que não corresponde ao disco é queixa", () => {
  const desatualizada = { ...FIXTURE_16_VS_17, majorCi: 15 };

  const queixas = divergencias(
    "postgres:16-alpine",
    "postgres:16-alpine",
    desatualizada,
    17,
  );

  assert.equal(queixas.length, 1);
  assert.match(queixas[0], /declara a divergência 15 x 17/);
});

test("RED: declaração órfã depois de a divergência acabar é queixa", () => {
  const queixas = divergencias(
    "postgres:17-alpine",
    "postgres:17-alpine",
    FIXTURE_16_VS_17,
    17,
  );

  assert.equal(queixas.length, 1);
  assert.match(queixas[0], /A divergência acabou/);
});

test("alinhar tudo em 17 e apagar a declaração é o único estado sem queixa nenhuma", () => {
  assert.deepEqual(divergencias("postgres:17-alpine", "postgres:17-alpine", null, 17), []);
});

test("RED: imagem que o gate não sabe ler é queixa, não aprovação", () => {
  const queixas = divergencias("postgres", "postgres:16-alpine", DIVERGENCIA_DECLARADA, 17);

  assert.equal(queixas.length, 1);
  assert.match(queixas[0], /não sei ler o major/);
});

// ------------------------------------------------------- os leitores de versão

test("majorDaImagem lê tag simples, com patch e com variante", () => {
  assert.equal(majorDaImagem("postgres:16"), 16);
  assert.equal(majorDaImagem("postgres:16.4"), 16);
  assert.equal(majorDaImagem("postgres:16-alpine"), 16);
  assert.equal(majorDaImagem("postgres:17.6-bookworm"), 17);
});

test("majorDaImagem devolve null para o que não é imagem do Postgres", () => {
  assert.equal(majorDaImagem("postgres"), null);
  assert.equal(majorDaImagem("mysql:8"), null);
  assert.equal(majorDaImagem("postgres:latest"), null);
});

test("imagemDoRunLocal lê a linha IMAGEM= do script real", () => {
  const script = readFileSync(CAMINHO_RUN_LOCAL, "utf8");

  assert.match(imagemDoRunLocal(script), /^postgres:\d/);
});

test("imagemDoRunLocal recusa em voz alta script sem IMAGEM=", () => {
  assert.throws(() => imagemDoRunLocal("#!/usr/bin/env bash\nset -e\n"), /run_local\.sh ilegível/);
});

// ------------------------------------------------------------------- o parser

test("parser: a imagem do serviço `postgres` do job `sql` é lida do arquivo real", () => {
  const servicos = lerServicosDoCi(lerCiYml(), "sql");

  assert.match(servicos.postgres, /^postgres:/);
});

test("parser: job sem `services:` devolve {} em vez de lançar", () => {
  assert.deepEqual(lerServicosDoCi(lerCiYml(), "node"), {});
});

test("parser: `env:` de dentro do serviço não é confundido com a imagem", () => {
  const yaml = `jobs:
  sql:
    services:
      postgres:
        image: postgres:16-alpine
        env:
          POSTGRES_PASSWORD: test
      redis:
        image: redis:7-alpine
    steps:
      - run: npm test
`;

  assert.deepEqual(lerServicosDoCi(yaml, "sql"), {
    postgres: "postgres:16-alpine",
    redis: "redis:7-alpine",
  });
});

test("parser: serviço sem `image:` é recusa explícita", () => {
  const yaml = `jobs:
  sql:
    services:
      postgres:
        env:
          POSTGRES_PASSWORD: test
    steps:
      - run: npm test
`;

  assert.throws(() => lerServicosDoCi(yaml, "sql"), /não tem `image:`/);
});

test("parser: `image:` vazia é recusa explícita", () => {
  const yaml = `jobs:
  sql:
    services:
      postgres:
        image:
    steps:
      - run: npm test
`;

  assert.throws(() => lerServicosDoCi(yaml, "sql"), /`image:` vazia/);
});
