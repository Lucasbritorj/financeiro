import { test } from "node:test";
import assert from "node:assert/strict";
import { lerCiYml, lerUsosDoCi, type UsoDeAcao } from "../gate/_ci-yml.ts";
import { ACOES_CONHECIDAS, type AcaoConhecida } from "../gate/acoes.ts";

// CONTRATO
//   Garante  — que nenhuma ação fixada no .github/workflows/ci.yml roda em
//              runtime Node 20, em NENHUM job do arquivo.
//   Falha se — o ci.yml fixar major abaixo do mínimo declarado em
//              tests/gate/acoes.ts, usar ação que aquela lista não conhece, ou
//              escrever a referência numa forma que este gate não sabe ler.
//   Espelha  — a propriedade "runtime da ação", não a última release: v6 e v7
//              passam, v4 não.
//   Vermelho — provado com ci.yml sintético em cada uma das quatro regras.
//
// Por que este gate existe: em 17/08/2026 o CI estava VERDE e mesmo assim
// avisava, nos dois jobs, que `actions/checkout@v4` e `actions/setup-node@v4`
// visam Node 20 e estavam sendo FORÇADAS para Node 24. Verde com aviso é a
// forma mais cara de dívida: não custa nada hoje e custa o CI inteiro no dia
// em que o GitHub parar de forçar — um dia que não é escolhido por ninguém
// deste lado, e que não vem acompanhado de commit para culpar.
//
// O que ele NÃO garante: que a ação nova funciona. Ler `@v6` no YAML não é
// executar `@v6`. Isto é análise de texto do ci.yml; o veredito de execução
// continua sendo o CI, depois do push.

/** As queixas do gate contra o par (`uses:` do ci.yml, tabela de ações). */
function divergencias(
  usos: readonly UsoDeAcao[],
  conhecidas: Readonly<Record<string, AcaoConhecida>>,
): string[] {
  const queixas: string[] = [];

  for (const { job, ref } of usos) {
    const corte = ref.lastIndexOf("@");
    if (corte < 0) {
      queixas.push(
        `o job \`${job}\` usa "${ref}" sem \`@versão\`. Ação sem versão fixada ` +
          `segue o default branch de terceiro: o que roda amanhã não é o que ` +
          `foi revisado hoje.`,
      );
      continue;
    }

    const nome = ref.slice(0, corte);
    const versao = ref.slice(corte + 1);
    const acao = conhecidas[nome];

    if (!acao) {
      queixas.push(
        `o job \`${job}\` usa "${nome}" e tests/gate/acoes.ts não conhece essa ` +
          `ação. Declare lá a partir de qual major ela roda em Node 24 — sem ` +
          `isso o gate ficaria verde sem ter olhado nada.`,
      );
      continue;
    }

    const casa = /^v(\d+)(?:[.\d]*)?$/.exec(versao);
    if (!casa) {
      queixas.push(
        `o job \`${job}\` fixa "${nome}" em "${versao}", e este gate só sabe ` +
          `ler tag \`vN\`. Pin por SHA é legítimo e mais seguro — mas então o ` +
          `major precisa estar declarado de um jeito que este teste enxergue, ` +
          `senão o gate promete uma cobertura que não tem.`,
      );
      continue;
    }

    const major = Number(casa[1]);
    if (major < acao.majorMinimo) {
      queixas.push(
        `o job \`${job}\` fixa ${nome}@v${major} e o primeiro major com runtime ` +
          `Node 24 é v${acao.majorMinimo}. Node 20 está deprecado nos runners: ` +
          `hoje o GitHub força a ação para Node 24 e o CI passa com annotation; ` +
          `quando parar de forçar, para de passar. Fonte: ${acao.fonte}`,
      );
    }
  }

  return queixas;
}

const YAML_MINIMO = `name: CI
on:
  push:
    branches: [master]

jobs:
  node:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
      - uses: actions/setup-node@v6
        with:
          node-version: 24
          cache: npm
      - run: npm test

  sql:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
      - name: asserts
        run: bash tests/sql/run_asserts.sh
`;

// ---------------------------------------------------------------- o gate real

test("suíte real: nenhuma ação do ci.yml roda em runtime Node 20", () => {
  const usos = lerUsosDoCi(lerCiYml());

  assert.deepEqual(
    divergencias(usos, ACOES_CONHECIDAS),
    [],
    "o ci.yml fixa ação com runtime Node 20. Bump o major no " +
      ".github/workflows/ci.yml — e, se a ação for nova, declare o mínimo dela " +
      "em tests/gate/acoes.ts. Não silencie este teste: o CI continua verde " +
      "com essa dívida até o dia em que não continua.",
  );
});

test("suíte real: o gate cobre os `uses:` dos dois jobs, não só do `node`", () => {
  const usos = lerUsosDoCi(lerCiYml());
  const jobs = new Set(usos.map((u) => u.job));

  assert.ok(jobs.has("node"), "nenhum `uses:` lido do job `node`");
  assert.ok(jobs.has("sql"), "nenhum `uses:` lido do job `sql`");
});

test("suíte real: toda ação usada está declarada em tests/gate/acoes.ts", () => {
  for (const { ref } of lerUsosDoCi(lerCiYml())) {
    const nome = ref.slice(0, ref.lastIndexOf("@"));
    assert.ok(
      nome in ACOES_CONHECIDAS,
      `"${nome}" é usada no ci.yml e não está em ACOES_CONHECIDAS`,
    );
  }
});

// ------------------------------------------------------- as quatro regras, RED

test("o gate não cobra nada quando todos os majors bastam", () => {
  assert.deepEqual(divergencias(lerUsosDoCi(YAML_MINIMO), ACOES_CONHECIDAS), []);
});

test("RED: major com runtime Node 20 é queixa, em qualquer job", () => {
  const comV4 = YAML_MINIMO.replace(
    "      - uses: actions/checkout@v6\n      - name: asserts",
    "      - uses: actions/checkout@v4\n      - name: asserts",
  );

  const queixas = divergencias(lerUsosDoCi(comV4), ACOES_CONHECIDAS);

  assert.equal(queixas.length, 1);
  assert.match(queixas[0], /job `sql`/);
  assert.match(queixas[0], /actions\/checkout@v4/);
  assert.match(queixas[0], /Node 24 é v5/);
});

test("RED: o major de hoje (v4) seria reprovado nos três `uses:` de uma vez", () => {
  const tudoV4 = YAML_MINIMO.replace(/@v6/g, "@v4");

  const queixas = divergencias(lerUsosDoCi(tudoV4), ACOES_CONHECIDAS);

  assert.equal(queixas.length, 3);
});

test("RED: ação que a tabela não conhece é queixa", () => {
  const comDesconhecida = YAML_MINIMO.replace(
    "      - run: npm test\n",
    "      - uses: codecov/codecov-action@v5\n      - run: npm test\n",
  );

  const queixas = divergencias(lerUsosDoCi(comDesconhecida), ACOES_CONHECIDAS);

  assert.equal(queixas.length, 1);
  assert.match(queixas[0], /codecov\/codecov-action/);
  assert.match(queixas[0], /não conhece essa ação/);
});

test("RED: referência sem `@versão` é queixa", () => {
  const semVersao = YAML_MINIMO.replace(
    "      - uses: actions/setup-node@v6\n",
    "      - uses: actions/setup-node\n",
  );

  const queixas = divergencias(lerUsosDoCi(semVersao), ACOES_CONHECIDAS);

  assert.equal(queixas.length, 1);
  assert.match(queixas[0], /sem `@versão`/);
});

test("RED: pin por SHA é recusa explícita, não aprovação silenciosa", () => {
  const porSha = YAML_MINIMO.replace(
    "actions/checkout@v6\n      - uses: actions/setup-node@v6",
    "actions/checkout@08c6903cd8c0fde910a37f88322edcfb5dd907a8\n      - uses: actions/setup-node@v6",
  );

  const queixas = divergencias(lerUsosDoCi(porSha), ACOES_CONHECIDAS);

  assert.equal(queixas.length, 1);
  assert.match(queixas[0], /só sabe ler tag/);
});

test("versão com patch completo (`v6.1.0`) passa como major 6", () => {
  const comPatch = YAML_MINIMO.replace("actions/setup-node@v6", "actions/setup-node@v6.5.0");

  assert.deepEqual(divergencias(lerUsosDoCi(comPatch), ACOES_CONHECIDAS), []);
});

// ------------------------------------------------------------------- o parser

test("parser: `uses:` de todos os jobs é coletado com o job de origem", () => {
  const usos = lerUsosDoCi(YAML_MINIMO);

  assert.deepEqual(usos, [
    { job: "node", ref: "actions/checkout@v6" },
    { job: "node", ref: "actions/setup-node@v6" },
    { job: "sql", ref: "actions/checkout@v6" },
  ]);
});

test("parser: step que só tem `run:` não vira `uses:`", () => {
  const usos = lerUsosDoCi(YAML_MINIMO);

  assert.ok(!usos.some((u) => u.ref.includes("npm test")));
});

test("parser: `with:` do step não é confundido com a referência da ação", () => {
  const usos = lerUsosDoCi(YAML_MINIMO);

  assert.ok(!usos.some((u) => u.ref.includes("node-version")));
  assert.ok(!usos.some((u) => u.ref.includes("cache")));
});

// Estas recusas são o que separa "gate vermelho" de "gate morto": devolver []
// diante de estrutura inesperada deixaria a suíte real verde para sempre.

test("parser: ci.yml sem nenhum `uses:` é recusa explícita, não lista vazia", () => {
  const semUses = "jobs:\n  node:\n    steps:\n      - run: npm test\n";

  assert.throws(() => lerUsosDoCi(semUses), /nenhum step com `uses:`/);
});

test("parser: YAML sem `jobs:` é recusa explícita", () => {
  assert.throws(() => lerUsosDoCi("name: CI\non: push\n"), /ci\.yml ilegível/);
});

test("parser: job sem `steps:` é recusa explícita", () => {
  const semSteps = "jobs:\n  node:\n    runs-on: ubuntu-latest\n";

  assert.throws(() => lerUsosDoCi(semSteps), /não tem `steps:`/);
});

test("parser: `uses:` vazio é recusa explícita", () => {
  const vazio = "jobs:\n  node:\n    steps:\n      - uses:\n      - run: npm test\n";

  assert.throws(() => lerUsosDoCi(vazio), /`uses:` vazio/);
});
