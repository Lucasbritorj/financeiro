import { test } from "node:test";
import assert from "node:assert/strict";
import { lerCiYml, lerJobDoCi, type JobCI } from "../gate/_ci-yml.ts";
import {
  ACOES_LOCAIS,
  ENV_DO_JOB,
  ETAPAS,
  type AcaoLocal,
  type Etapa,
} from "../gate/etapas.ts";

// CONTRATO
//   Garante  — que o alvo local `npm run gate` continua sendo o job `node` do
//              .github/workflows/ci.yml: as mesmas etapas `run`, na mesma
//              ordem, com o mesmo `env`, e nenhuma etapa fora de execução
//              literal sem motivo declarado.
//   Falha se — o ci.yml ganhar etapa que tests/gate/etapas.ts não classifica,
//              perder etapa que ele ainda classifica, trocar a ordem, ou mudar
//              o `env` que o runner injeta.
//   Espelha  — o contrato entre dois arquivos, não um comando: é análise de
//              texto do ci.yml, não execução de CI.
//   Vermelho — provado com ci.yml sintético em cada uma das quatro regras.
//
// Por que este gate existe: um alvo local que repete os comandos do CI é um
// segundo lugar onde a verdade mora, e os dois divergem em silêncio. A
// divergência não aparece quando acontece — aparece semanas depois, no push,
// com o gate local verde. Este teste faz a divergência custar um teste
// vermelho no mesmo `npm test` de sempre.
//
// O que ele NÃO garante: que o comando local produz o mesmo resultado que o
// comando do CI. `npm test` aqui e `npm test` no runner podem divergir por
// versão de Node, sistema de arquivos ou rede. Isto é pareamento de contrato,
// não equivalência de execução.

/** As queixas do gate contra o par (etapas.ts, job `node` do ci.yml). */
function divergencias(etapas: readonly Etapa[], job: JobCI): string[] {
  const queixas: string[] = [];
  const locais = etapas.map((e) => e.ci);
  const doCi = job.etapasRun;

  for (const etapa of doCi) {
    if (!locais.includes(etapa)) {
      queixas.push(
        `o job \`node\` roda "${etapa}" e tests/gate/etapas.ts não classifica ` +
          `essa etapa. Toda etapa do CI precisa estar lá — como coberta, como ` +
          `equivalente local, ou como fora de escopo com motivo.`,
      );
    }
  }

  for (const etapa of locais) {
    if (!doCi.includes(etapa)) {
      queixas.push(
        `tests/gate/etapas.ts classifica "${etapa}" e o job \`node\` não roda ` +
          `mais essa etapa. Classificação órfã faz o gate local prometer o que ` +
          `o CI não cobra.`,
      );
    }
  }

  // Só cobra ordem quando os dois lados têm o mesmo conjunto: senão a queixa
  // de ordem seria ruído por cima da queixa que importa.
  const mesmaOrdem =
    locais.length === doCi.length && locais.every((etapa, i) => etapa === doCi[i]);

  if (queixas.length === 0 && !mesmaOrdem) {
    queixas.push(
      `a ordem das etapas diverge. ci.yml: ${doCi.join(" -> ")}. ` +
        `etapas.ts: ${locais.join(" -> ")}. O CI para na primeira falha, então ` +
        `a ordem decide qual erro aparece primeiro.`,
    );
  }

  for (const [chave, valor] of Object.entries(job.env)) {
    if (ENV_DO_JOB[chave] !== valor) {
      queixas.push(
        `o job \`node\` declara ${chave}="${valor}" e o runner injeta ` +
          `${ENV_DO_JOB[chave] === undefined ? "nada" : `"${ENV_DO_JOB[chave]}"`}. ` +
          `O build local mediria um ambiente que o CI não tem.`,
      );
    }
  }

  for (const chave of Object.keys(ENV_DO_JOB)) {
    if (!(chave in job.env)) {
      queixas.push(
        `o runner injeta ${chave} e o job \`node\` não declara mais essa ` +
          `variável. Injetar o que o CI não tem é o mesmo erro, ao contrário.`,
      );
    }
  }

  for (const etapa of etapas) {
    if (etapa.local.tipo !== "externo" && !etapa.motivo) {
      queixas.push(
        `"${etapa.ci}" não roda o comando do CI e não declara motivo. ` +
          `Divergir do CI é legítimo — divergir em silêncio não é.`,
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
    env:
      NEXT_PUBLIC_SUPABASE_URL: https://placeholder.supabase.co
      NEXT_PUBLIC_SUPABASE_ANON_KEY: placeholder
    steps:
      - uses: actions/checkout@v4
      - name: pin do npm declarado em packageManager
        run: |
          NPM_PIN=$(node -p "require('./package.json').packageManager")
          npm i -g npm@$NPM_PIN
      - run: npm ci
      - run: npx tsc --noEmit
      - run: npm run lint
      - run: npm test
      - run: npm run build
`;

/** As etapas locais que pareiam com YAML_MINIMO, sem depender de etapas.ts. */
const LOCAIS_MINIMAS: readonly Etapa[] = [
  {
    ci: "pin do npm declarado em packageManager",
    local: { tipo: "interno", chave: "pin-npm" },
    motivo: "não instala nada global",
  },
  { ci: "npm ci", local: { tipo: "nenhum" }, motivo: "exige rede" },
  { ci: "npx tsc --noEmit", local: { tipo: "externo", comando: ["npx", "tsc", "--noEmit"] } },
  { ci: "npm run lint", local: { tipo: "externo", comando: ["npm", "run", "lint"] } },
  { ci: "npm test", local: { tipo: "externo", comando: ["npm", "test"] } },
  { ci: "npm run build", local: { tipo: "externo", comando: ["npm", "run", "build"] } },
];

// ---------------------------------------------------------------- o gate real

test("suíte real: o alvo local não diverge do job `node` do ci.yml", () => {
  const job = lerJobDoCi(lerCiYml(), "node");

  assert.deepEqual(
    divergencias(ETAPAS, job),
    [],
    "o alvo local `npm run gate` deixou de espelhar o job `node`. Conserte " +
      "tests/gate/etapas.ts — e, se a etapa nova precisar rodar localmente, " +
      "tests/gate/run.ts também. Não silencie este teste: ele é a única coisa " +
      "que impede `npm run gate` de virar um gate do CI de ontem.",
  );
});

test("suíte real: toda etapa coberta declara o comando que roda", () => {
  for (const etapa of ETAPAS) {
    if (etapa.local.tipo === "externo") {
      assert.ok(etapa.local.comando.length > 0, `"${etapa.ci}" tem comando vazio`);
    }
  }
});

// ------------------------------------------------------- as quatro regras, RED

test("o gate não cobra nada quando as duas listas batem", () => {
  const job = lerJobDoCi(YAML_MINIMO, "node");

  assert.deepEqual(divergencias(LOCAIS_MINIMAS, job), []);
});

test("RED: etapa nova no ci.yml sem classificação local é queixa", () => {
  const comEtapaNova = YAML_MINIMO.replace(
    "      - run: npm run build\n",
    "      - run: npm run build\n      - run: npm run audit:ci\n",
  );
  const job = lerJobDoCi(comEtapaNova, "node");

  const queixas = divergencias(LOCAIS_MINIMAS, job);

  assert.equal(queixas.length, 1);
  assert.match(queixas[0], /npm run audit:ci/);
  assert.match(queixas[0], /não classifica/);
});

test("RED: ordem trocada é queixa, mesmo com o conjunto idêntico", () => {
  const trocado: readonly Etapa[] = [
    LOCAIS_MINIMAS[0],
    LOCAIS_MINIMAS[1],
    LOCAIS_MINIMAS[3], // lint antes de tsc
    LOCAIS_MINIMAS[2],
    LOCAIS_MINIMAS[4],
    LOCAIS_MINIMAS[5],
  ];
  const job = lerJobDoCi(YAML_MINIMO, "node");

  const queixas = divergencias(trocado, job);

  assert.equal(queixas.length, 1);
  assert.match(queixas[0], /ordem das etapas diverge/);
});

test("RED: classificação órfã (etapa que o CI não roda mais) é queixa", () => {
  const semLint = YAML_MINIMO.replace("      - run: npm run lint\n", "");
  const job = lerJobDoCi(semLint, "node");

  const queixas = divergencias(LOCAIS_MINIMAS, job);

  assert.equal(queixas.length, 1);
  assert.match(queixas[0], /npm run lint/);
  assert.match(queixas[0], /órfã/);
});

test("RED: env do job divergente do que o runner injeta é queixa", () => {
  const outraUrl = YAML_MINIMO.replace(
    "https://placeholder.supabase.co",
    "https://outro.supabase.co",
  );
  const job = lerJobDoCi(outraUrl, "node");

  const queixas = divergencias(LOCAIS_MINIMAS, job);

  assert.equal(queixas.length, 1);
  assert.match(queixas[0], /NEXT_PUBLIC_SUPABASE_URL/);
});

test("RED: variável que o runner injeta e o job não declara mais é queixa", () => {
  const semAnon = YAML_MINIMO.replace("      NEXT_PUBLIC_SUPABASE_ANON_KEY: placeholder\n", "");
  const job = lerJobDoCi(semAnon, "node");

  const queixas = divergencias(LOCAIS_MINIMAS, job);

  assert.equal(queixas.length, 1);
  assert.match(queixas[0], /NEXT_PUBLIC_SUPABASE_ANON_KEY/);
});

test("RED: etapa que não roda o comando do CI e não declara motivo é queixa", () => {
  const semMotivo: readonly Etapa[] = LOCAIS_MINIMAS.map((etapa) =>
    etapa.ci === "npm ci" ? { ci: etapa.ci, local: etapa.local } : etapa,
  );
  const job = lerJobDoCi(YAML_MINIMO, "node");

  const queixas = divergencias(semMotivo, job);

  assert.equal(queixas.length, 1);
  assert.match(queixas[0], /não declara motivo/);
});

// ------------------------------------------------- as ações locais (local-only)

// ACOES_LOCAIS é a categoria de verificação que existe SÓ no gate local. Ela
// foi criada para que o preflight do lock não precisasse virar uma `Etapa` —
// e uma `Etapa` sem step correspondente no ci.yml é "classificação órfã", que
// as regras acima reprovam de propósito.
//
// A categoria nova abre dois furos próprios, e são estes quatro testes que os
// fecham: uma ação com o nome de um step do CI vira etapa-gêmea disfarçada, e
// uma ação ancorada numa etapa inexistente nunca é executada pelo runner —
// cobertura prometida e não entregue, que é pior que lacuna declarada.

/** As queixas do gate contra as ações locais, dadas as etapas e o job. */
function queixasDeAcoes(
  acoes: readonly AcaoLocal[],
  etapas: readonly Etapa[],
  doCi: readonly string[],
): string[] {
  const queixas: string[] = [];
  const ancoras = new Set(etapas.map((e) => e.ci));

  for (const acao of acoes) {
    if (doCi.includes(acao.nome)) {
      queixas.push(
        `a ação local "${acao.nome}" tem o nome de um step do job \`node\`. ` +
          `Ação local que se disfarça de etapa vira etapa-gêmea: ou o gate ` +
          `roda a mesma coisa duas vezes, ou alguém acrescenta o step gêmeo no ` +
          `ci.yml e o CI passa a pagar de novo o que já paga.`,
      );
    }

    if (!ancoras.has(acao.reduzLacunaDe)) {
      queixas.push(
        `a ação local "${acao.nome}" ancora em "${acao.reduzLacunaDe}", que ` +
          `não está em tests/gate/etapas.ts. Âncora órfã é ação que o runner ` +
          `nunca executa — o gate prometeria a cobertura e não a entregaria.`,
      );
    }

    if (acao.comando.length === 0) {
      queixas.push(`a ação local "${acao.nome}" não declara comando.`);
    }

    if (acao.motivo.trim() === "") {
      queixas.push(
        `a ação local "${acao.nome}" não declara motivo. Rodar localmente o ` +
          `que o CI não roda é legítimo — fazer isso em silêncio não é.`,
      );
    }
  }

  return queixas;
}

/** Ações locais sintéticas que pareiam com LOCAIS_MINIMAS e YAML_MINIMO. */
const ACOES_MINIMAS: readonly AcaoLocal[] = [
  {
    nome: "preflight: lock em sincronia",
    comando: ["npm", "ci", "--dry-run"],
    motivo: "valida o lock sem escrever em disco",
    reduzLacunaDe: "npm ci",
  },
];

test("suíte real: as ações locais não são cobradas contra o ci.yml", () => {
  const job = lerJobDoCi(lerCiYml(), "node");

  // Sem ação nenhuma este teste passaria por vacuidade, e a asserção de baixo
  // seria uma afirmação sobre um conjunto vazio.
  assert.ok(ACOES_LOCAIS.length > 0, "não há ação local para este gate guardar");
  assert.deepEqual(queixasDeAcoes(ACOES_LOCAIS, ETAPAS, job.etapasRun), []);
});

test("suíte real: a ação local não desloca o pareamento das etapas com o ci.yml", () => {
  const job = lerJobDoCi(lerCiYml(), "node");

  // O ponto do tipo separado: ACOES_LOCAIS pode crescer sem que o pareamento
  // sinta. Se um dia alguém mover uma dessas para ETAPAS, é esta asserção que
  // fica vermelha — como "classificação órfã".
  assert.deepEqual(divergencias(ETAPAS, job), []);
});

test("suíte real: a lacuna do `npm ci` tem preflight ancorado nela", () => {
  const preflight = ACOES_LOCAIS.find((acao) => acao.reduzLacunaDe === "npm ci");

  assert.ok(
    preflight,
    "a etapa `npm ci` é a única do job `node` sem equivalente local, e é a " +
      "que derrubou o CI de 13/08/2026. Se o preflight dela sumir, o gate " +
      "volta a não ver lock dessincronizado — e volta em silêncio.",
  );
  assert.deepEqual(preflight.comando, ["npm", "ci", "--dry-run"]);
});

test("o gate não cobra nada quando as ações locais estão bem formadas", () => {
  const job = lerJobDoCi(YAML_MINIMO, "node");

  assert.deepEqual(queixasDeAcoes(ACOES_MINIMAS, LOCAIS_MINIMAS, job.etapasRun), []);
});

test("RED: ação local com o nome de um step do CI é queixa (etapa-gêmea)", () => {
  const gemea: readonly AcaoLocal[] = [{ ...ACOES_MINIMAS[0], nome: "npm ci" }];
  const job = lerJobDoCi(YAML_MINIMO, "node");

  const queixas = queixasDeAcoes(gemea, LOCAIS_MINIMAS, job.etapasRun);

  assert.equal(queixas.length, 1);
  assert.match(queixas[0], /etapa-gêmea/);
});

test("RED: ação local ancorada em etapa inexistente é queixa", () => {
  const solta: readonly AcaoLocal[] = [
    { ...ACOES_MINIMAS[0], reduzLacunaDe: "npm run audit:ci" },
  ];
  const job = lerJobDoCi(YAML_MINIMO, "node");

  const queixas = queixasDeAcoes(solta, LOCAIS_MINIMAS, job.etapasRun);

  assert.equal(queixas.length, 1);
  assert.match(queixas[0], /Âncora órfã/);
});

test("RED: ação local sem motivo é queixa", () => {
  const muda: readonly AcaoLocal[] = [{ ...ACOES_MINIMAS[0], motivo: "   " }];
  const job = lerJobDoCi(YAML_MINIMO, "node");

  const queixas = queixasDeAcoes(muda, LOCAIS_MINIMAS, job.etapasRun);

  assert.equal(queixas.length, 1);
  assert.match(queixas[0], /não declara motivo/);
});

// ------------------------------------------------------------------- o parser

test("parser: `name:` do step vence a primeira linha do `run:` como identidade", () => {
  const job = lerJobDoCi(YAML_MINIMO, "node");

  assert.equal(job.etapasRun[0], "pin do npm declarado em packageManager");
  assert.ok(!job.etapasRun.some((etapa) => etapa.startsWith("NPM_PIN=")));
});

test("parser: step sem `name:` e com bloco literal usa a primeira linha do comando", () => {
  const yaml = `jobs:
  node:
    steps:
      - run: |
          npm ci
          npm test
`;

  assert.deepEqual(lerJobDoCi(yaml, "node").etapasRun, ["npm ci"]);
});

test("parser: steps com só `uses:` não viram etapa", () => {
  const job = lerJobDoCi(YAML_MINIMO, "node");

  assert.equal(job.etapasRun.length, 6);
  assert.ok(!job.etapasRun.some((etapa) => etapa.includes("actions/checkout")));
});

test("parser: valor de env com `:` no meio sobrevive inteiro", () => {
  const job = lerJobDoCi(YAML_MINIMO, "node");

  assert.equal(job.env.NEXT_PUBLIC_SUPABASE_URL, "https://placeholder.supabase.co");
});

test("parser: comentário na coluna dos steps não apaga o step seguinte", () => {
  const comComentario = YAML_MINIMO.replace(
    "      - run: npm ci\n",
    "      # o lock precisa estar sincronizado, senão isto morre em 8s\n      - run: npm ci\n",
  );

  assert.deepEqual(
    lerJobDoCi(comComentario, "node").etapasRun,
    lerJobDoCi(YAML_MINIMO, "node").etapasRun,
  );
});

test("parser: o job `sql` do arquivo real é lido separado, sem vazar para o `node`", () => {
  const sql = lerJobDoCi(lerCiYml(), "sql");
  const node = lerJobDoCi(lerCiYml(), "node");

  assert.ok(sql.etapasRun.length > 0);
  for (const etapa of sql.etapasRun) {
    assert.ok(!node.etapasRun.includes(etapa), `"${etapa}" vazou do job sql para o node`);
  }
});

// Estas quatro recusas são o que separa "gate vermelho" de "gate morto": um
// parser que devolvesse [] diante de estrutura inesperada deixaria o teste da
// suíte real verde para sempre, e ninguém saberia.

test("parser: YAML sem `jobs:` é recusa explícita, não lista vazia", () => {
  assert.throws(() => lerJobDoCi("name: CI\non: push\n", "node"), /ci\.yml ilegível/);
});

test("parser: job inexistente é recusa explícita", () => {
  assert.throws(() => lerJobDoCi(YAML_MINIMO, "deploy"), /não achei o job `deploy`/);
});

test("parser: job sem `steps:` é recusa explícita", () => {
  const yaml = "jobs:\n  node:\n    runs-on: ubuntu-latest\n";

  assert.throws(() => lerJobDoCi(yaml, "node"), /não tem `steps:`/);
});

test("parser: job cujos steps não têm nenhum `run:` é recusa explícita", () => {
  const yaml = "jobs:\n  node:\n    steps:\n      - uses: actions/checkout@v4\n";

  assert.throws(() => lerJobDoCi(yaml, "node"), /nenhum step com `run:`/);
});
