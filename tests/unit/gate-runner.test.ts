import { test } from "node:test";
import assert from "node:assert/strict";
import {
  avaliarPinDoNpm,
  codigoDeSaida,
  executarSequencia,
  preencherFaltantes,
} from "../gate/run.ts";
import type { Etapa } from "../gate/etapas.ts";

// CONTRATO
//   Garante  — que o runner de `npm run gate` para na primeira etapa vermelha,
//              propaga o código de saída dela, não executa o que vem depois, e
//              preenche o env do job sem sobrescrever o que já existe.
//   Falha se — uma etapa vermelha deixar de abortar a sequência, o exit code
//              virar 0 por acidente, ou o env do desenvolvedor for sobrescrito.
//   Espelha  — o comportamento de parada do job `node` do CI, não os comandos
//              dele: quem confere os comandos é tests/unit/gate-node-ci.test.ts.
//   Vermelho — provado com etapas sintéticas, abaixo. Nenhum teste aqui roda
//              tsc, lint ou build de verdade: o executor é injetado.
//
// Um gate cujo runner engolisse o exit code seria pior que gate nenhum — ele
// imprimiria "FALHOU" na tela e devolveria 0 para o shell, e todo uso
// automatizado (hook de pre-commit, script de release) leria verde. Por isso a
// propagação tem teste próprio, separado dos comandos que ela carrega.

/** Etapa sintética que roda um comando externo. O comando nunca é executado. */
function etapaExterna(nome: string): Etapa {
  return { ci: nome, local: { tipo: "externo", comando: ["echo", nome] } };
}

const ETAPAS_SINTETICAS: readonly Etapa[] = [
  etapaExterna("primeira"),
  etapaExterna("segunda"),
  etapaExterna("terceira"),
];

test("GREEN: com todas as etapas em 0, todas executam e o código final é 0", () => {
  const executadas: string[] = [];

  const resultados = executarSequencia(ETAPAS_SINTETICAS, (etapa) => {
    executadas.push(etapa.ci);
    return 0;
  });

  assert.deepEqual(executadas, ["primeira", "segunda", "terceira"]);
  assert.equal(codigoDeSaida(resultados), 0);
});

test("RED: etapa vermelha aborta a sequência e o código dela é o código final", () => {
  const executadas: string[] = [];

  const resultados = executarSequencia(ETAPAS_SINTETICAS, (etapa) => {
    executadas.push(etapa.ci);
    return etapa.ci === "segunda" ? 2 : 0;
  });

  // A terceira não pode ter rodado: é o que faz `npm run gate` custar segundos
  // em vez de minutos quando o tsc já reprovou.
  assert.deepEqual(executadas, ["primeira", "segunda"]);
  assert.equal(codigoDeSaida(resultados), 2);
  assert.equal(resultados.length, 2);
});

test("RED: exit code é propagado como está, não normalizado para 1", () => {
  const resultados = executarSequencia([etapaExterna("única")], () => 127);

  assert.equal(codigoDeSaida(resultados), 127);
});

test("etapa declarada fora de escopo é pulada sem abortar a sequência", () => {
  const etapas: readonly Etapa[] = [
    { ci: "npm ci", local: { tipo: "nenhum" }, motivo: "exige rede" },
    etapaExterna("depois"),
  ];
  const executadas: string[] = [];

  const resultados = executarSequencia(etapas, (etapa) => {
    executadas.push(etapa.ci);
    return 0;
  });

  assert.deepEqual(executadas, ["depois"]);
  assert.equal(resultados[0].executada, false);
  assert.equal(codigoDeSaida(resultados), 0);
});

test("preencherFaltantes completa o que falta e não toca no que já existe", () => {
  const base = { NEXT_PUBLIC_SUPABASE_URL: "https://real.supabase.co" };

  const complemento = preencherFaltantes(base, {
    NEXT_PUBLIC_SUPABASE_URL: "https://placeholder.supabase.co",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "placeholder",
  });

  // A variável real não pode aparecer no complemento: sobrescrevê-la mandaria
  // o build medir um ambiente que ninguém tem.
  assert.deepEqual(complemento, { NEXT_PUBLIC_SUPABASE_ANON_KEY: "placeholder" });
});

test("preencherFaltantes trata string vazia como ausente", () => {
  assert.deepEqual(preencherFaltantes({ CHAVE: "" }, { CHAVE: "preenchida" }), {
    CHAVE: "preenchida",
  });
});

test("preencherFaltantes devolve objeto vazio quando o ambiente já tem tudo", () => {
  const base = { A: "1", B: "2" };

  assert.deepEqual(preencherFaltantes(base, { A: "x", B: "y" }), {});
});

test("avaliarPinDoNpm: versão igual ao pin não tem queixa", () => {
  assert.equal(avaliarPinDoNpm("11.17.0", "npm@11.17.0"), null);
});

test("avaliarPinDoNpm: versão diferente cita as duas versões na queixa", () => {
  const queixa = avaliarPinDoNpm("11.6.2", "npm@11.17.0");

  assert.ok(queixa);
  assert.match(queixa, /11\.6\.2/);
  assert.match(queixa, /11\.17\.0/);
});

test("avaliarPinDoNpm: package.json sem packageManager é queixa, não silêncio", () => {
  const queixa = avaliarPinDoNpm("11.17.0", undefined);

  assert.ok(queixa);
  assert.match(queixa, /packageManager/);
});

test("avaliarPinDoNpm: pin que não é de npm é queixa", () => {
  const queixa = avaliarPinDoNpm("11.17.0", "pnpm@9.0.0");

  assert.ok(queixa);
  assert.match(queixa, /pnpm@9\.0\.0/);
});
