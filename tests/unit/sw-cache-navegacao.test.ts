import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { readFileSync, readdirSync } from "node:fs";

// Enforcement do que o service worker pode guardar. Existe porque a versão
// anterior do sw.js cacheava TODA navegação bem-sucedida por URL, e o HTML de
// (protegido) é SSR com os dados do usuário dentro — em navegador compartilhado,
// o fallback offline devolvia a tela de um usuário para o seguinte.
//
// O caso não era hipotético: bastava ativar modo avião depois de outra conta ter
// aberto /transacoes. Cache Storage é uma entrada por URL, por origem, e `Cookie`
// é forbidden header — não chega ao fetch event —, então não existe partição por
// sessão a ser feita ali. A única defesa é não gravar.
//
// O teste "toda rota de (protegido) é recusada" é o que impede a regressão: ele
// lê o diretório do disco, então rota nova entra na verificação sozinha.

const require_ = createRequire(import.meta.url);
const RAIZ = new URL("../../", import.meta.url);
// fileURLToPath, não .pathname: no Windows o pathname vem "/C:/..." e o require
// não resolve.
const { podeCachearNavegacao, podeGravarNavegacao, ROTAS_PUBLICAS, NOME_CACHE } = require_(
  fileURLToPath(new URL("public/sw-rotas.js", RAIZ)),
);

const sw = readFileSync(new URL("public/sw.js", RAIZ), "utf8");
const sairBotao = readFileSync(new URL("src/components/sair-botao.tsx", RAIZ), "utf8");

function rotasProtegidas(): string[] {
  return readdirSync(new URL("src/app/(protegido)", RAIZ), { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => `/${e.name}`);
}

test("suíte real: nenhuma rota de (protegido) pode ser cacheada", () => {
  const rotas = rotasProtegidas();
  assert.ok(rotas.length > 0, "não achei rota protegida — o teste perderia o sentido");
  for (const rota of rotas) {
    assert.equal(
      podeCachearNavegacao(rota),
      false,
      `${rota} seria cacheada: HTML de rota protegida vaza para o próximo usuário do navegador`,
    );
  }
});

test("rota pública é cacheável (senão o fallback offline não serve para nada)", () => {
  assert.equal(podeCachearNavegacao("/"), true);
  assert.equal(podeCachearNavegacao("/login"), true);
});

test("barra final não burla a decisão", () => {
  assert.equal(podeCachearNavegacao("/login/"), true);
  assert.equal(podeCachearNavegacao("/transacoes/"), false);
});

test("vermelho: rota desconhecida é recusada por padrão, não liberada", () => {
  // A whitelist é o ponto: rota que ninguém classificou nasce fora do cache.
  assert.equal(podeCachearNavegacao("/rota-que-nao-existe-ainda"), false);
  assert.equal(podeCachearNavegacao("/transacoes/123"), false);
});

test("vermelho: entrada degenerada não vira 'pode cachear'", () => {
  assert.equal(podeCachearNavegacao(""), false);
  assert.equal(podeCachearNavegacao(undefined as unknown as string), false);
  assert.equal(podeCachearNavegacao(null as unknown as string), false);
  assert.equal(podeCachearNavegacao(42 as unknown as string), false);
});

test("a whitelist não contém nenhuma rota protegida", () => {
  const protegidas = new Set(rotasProtegidas());
  for (const publica of ROTAS_PUBLICAS) {
    assert.equal(
      protegidas.has(publica),
      false,
      `${publica} está na whitelist E em (protegido)`,
    );
  }
});

test("o sw usa a decisão em vez de cachear navegação incondicionalmente", () => {
  assert.match(sw, /importScripts\("\/sw-rotas\.js"\)/, "sw.js não carrega sw-rotas.js");
  assert.match(sw, /podeCachearNavegacao\(url\.pathname\)/, "sw.js não consulta a decisão");
});

test("a branch de navegação delega a decisão em vez de decidir inline", () => {
  const navegacao = sw.slice(sw.indexOf('request.mode === "navigate"'));
  assert.match(
    navegacao,
    /if \(podeGravarNavegacao\(url\.pathname, resposta\)\)/,
    "a branch de navegação não usa podeGravarNavegacao: a decisão voltou a ser texto não executável",
  );
});

test("suíte real: navegação com resposta 500 não é gravada", () => {
  // fetch só rejeita em falha de rede; um 500 durante deploy resolve normalmente
  // e viraria a "última tela boa" que o fallback promete.
  assert.equal(podeGravarNavegacao("/login", { ok: false, redirected: false }), false);
});

test("suíte real: navegação REDIRECIONADA não é gravada, mesmo em rota pública", () => {
  // O buraco que a whitelist sozinha não fecha: ela julga o pathname PEDIDO, e o
  // cache guarda o corpo ENTREGUE. Hoje as duas rotas públicas entregam
  // /transacoes a quem tem sessão — "/" faz redirect() em src/app/page.tsx e
  // "/login" é mandado para /transacoes pelo proxy. Sem isto, o HTML SSR com
  // descrição, valor e data reais é gravado sob a chave "/" ou "/login".
  for (const rota of ROTAS_PUBLICAS) {
    assert.equal(
      podeGravarNavegacao(rota, { ok: true, redirected: true }),
      false,
      `${rota} gravaria o corpo da URL final sob a própria chave: HTML privado no Cache Storage`,
    );
  }
});

test("suíte real: navegação pública, ok e não redirecionada É gravada", () => {
  // Sem este, uma decisão que respondesse `false` para tudo passaria em todos os
  // asserts acima sem cachear coisa nenhuma.
  assert.equal(podeGravarNavegacao("/login", { ok: true, redirected: false }), true);
});

test("vermelho: rota protegida não grava nem com resposta perfeita", () => {
  for (const rota of rotasProtegidas()) {
    assert.equal(podeGravarNavegacao(rota, { ok: true, redirected: false }), false, rota);
  }
});

test("vermelho: resposta degenerada não vira 'pode gravar'", () => {
  assert.equal(podeGravarNavegacao("/login", undefined as never), false);
  assert.equal(podeGravarNavegacao("/login", null as never), false);
  assert.equal(podeGravarNavegacao("/login", {} as never), false);
  // `ok` só vale como boolean true — string não vazia não conta.
  assert.equal(podeGravarNavegacao("/login", { ok: "sim", redirected: false } as never), false);
});

test("o nome do cache subiu de novo (senão o cache contaminado sobrevive)", () => {
  // O activate apaga todo cache de nome diferente do atual, então o bump é o que
  // purga conteúdo já gravado nos navegadores. v1 tinha HTML de rota protegida;
  // v2 tinha HTML de /transacoes gravado sob a chave "/" ou "/login".
  assert.notEqual(NOME_CACHE, "atelie-v1");
  assert.notEqual(NOME_CACHE, "atelie-v2");
  assert.match(NOME_CACHE, /^atelie-v\d+$/);
});

test("o logout apaga o cache", () => {
  assert.match(
    sairBotao,
    /caches\.delete/,
    "sair-botao.tsx não purga o Cache Storage: a tela do usuário anterior fica servível",
  );
  assert.match(sairBotao, /await limparCaches\(\)/, "limparCaches não é chamado no sair()");
});
