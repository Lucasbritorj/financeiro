import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import nextConfig from "../../next.config.ts";

// GHSA-6gpp-xcg3-4w24 (CVE-2026-64642, CVSS 8.3): em App Router com Turbopack,
// o proxy é ignorado quando `config.i18n.locales` tem UMA única entrada. Neste
// app o src/proxy.ts é quem exige sessão e redireciona para /login — bypass do
// proxy é bypass de autenticação, não detalhe de roteamento.
//
// O app não é vulnerável hoje porque não declara `i18n`. Isso é ausência de
// configuração, não barreira: nada impede alguém de adicionar i18n amanhã e
// reabrir o buraco em silêncio. Este teste existe para que essa combinação
// quebre o CI enquanto o next estiver abaixo da primeira versão corrigida.
//
// Ao subir o next para 16.2.11+, este teste passa a ser vacuamente verde e
// pode ser removido junto com o bump.
const PRIMEIRA_VERSAO_CORRIGIDA = "16.2.11";

/** Compara "16.2.10" com "16.2.11" numericamente. Pré-release conta como menor. */
function versaoMenorQue(versao: string, alvo: string): boolean {
  const [nucleo, pre] = versao.split("-");
  const a = nucleo.split(".").map(Number);
  const b = alvo.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] < b[i];
  }
  // Mesmo núcleo: 16.2.11-canary.0 ainda não é 16.2.11.
  return pre !== undefined;
}

/** A condição de exploração do advisory: locale único configurado. */
function temLocaleUnico(i18n: unknown): boolean {
  if (i18n === null || typeof i18n !== "object") return false;
  const locales = (i18n as { locales?: unknown }).locales;
  return Array.isArray(locales) && locales.length === 1;
}

function versaoInstaladaDoNext(): string {
  const url = new URL("../../node_modules/next/package.json", import.meta.url);
  return JSON.parse(readFileSync(url, "utf8")).version as string;
}

// O guard só vale se souber falhar. Sem estes casos, um bug na comparação
// deixaria o teste verde para sempre — que é o modo de falha que este run
// inteiro existe para evitar.
test("versaoMenorQue: reconhece as fronteiras da versão corrigida", () => {
  assert.equal(versaoMenorQue("16.2.10", PRIMEIRA_VERSAO_CORRIGIDA), true);
  assert.equal(versaoMenorQue("16.2.11", PRIMEIRA_VERSAO_CORRIGIDA), false);
  assert.equal(versaoMenorQue("16.2.12", PRIMEIRA_VERSAO_CORRIGIDA), false);
  assert.equal(versaoMenorQue("16.3.0", PRIMEIRA_VERSAO_CORRIGIDA), false);
  assert.equal(versaoMenorQue("16.1.99", PRIMEIRA_VERSAO_CORRIGIDA), true);
  assert.equal(versaoMenorQue("15.5.20", PRIMEIRA_VERSAO_CORRIGIDA), true);
  assert.equal(versaoMenorQue("16.2.11-canary.3", PRIMEIRA_VERSAO_CORRIGIDA), true);
});

test("temLocaleUnico: só dispara com exatamente uma entrada", () => {
  assert.equal(temLocaleUnico({ locales: ["pt-BR"] }), true);
  assert.equal(temLocaleUnico({ locales: ["pt-BR", "en"] }), false);
  assert.equal(temLocaleUnico({ locales: [] }), false);
  assert.equal(temLocaleUnico({}), false);
  assert.equal(temLocaleUnico(undefined), false);
});

test("next.config não pode combinar locale único com next vulnerável ao bypass de proxy", () => {
  const versao = versaoInstaladaDoNext();
  const i18n = (nextConfig as { i18n?: unknown }).i18n;

  assert.equal(
    versaoMenorQue(versao, PRIMEIRA_VERSAO_CORRIGIDA) && temLocaleUnico(i18n),
    false,
    `next ${versao} é vulnerável ao GHSA-6gpp-xcg3-4w24 e next.config.ts declara ` +
      `i18n.locales com uma única entrada. Essa combinação faz o Turbopack ignorar ` +
      `o src/proxy.ts, que é quem exige sessão — as rotas ficam acessíveis sem login. ` +
      `Suba o next para ${PRIMEIRA_VERSAO_CORRIGIDA} ou superior, ou declare mais de um locale.`,
  );
});
