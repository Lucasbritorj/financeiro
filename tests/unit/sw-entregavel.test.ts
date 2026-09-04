import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { scriptsImportados, pathnameServido } from "../lib/sw-importscripts.mjs";

// CONTRATO
//
// O que garante: todo script que o service worker carrega por `importScripts` é
// entregue pelo servidor como JavaScript, sem passar pelo proxy de sessão.
//
// Condição objetiva que o faz falhar: um caminho importado pelo public/sw.js
// casa com algum padrão do `matcher` de src/proxy.ts.
//
// Regra de produção espelhada: o matcher é quem decide o que o proxy intercepta
// e redireciona para /login quando não há sessão.
//
// Entrada sintética que prova o caminho vermelho: MATCHER_ANTES_DO_FIX, abaixo —
// o matcher real de 01/09/2026, que produziu a falha em produção.
//
// POR QUE ESTE TESTE EXISTE
//
// Em 01/09/2026 a correção do vazamento do PWA foi para produção sem efeito
// nenhum, e nada acusou. O sw.js v2 subiu correto e era servido em 200; o
// sw-rotas.js, criado no MESMO commit, ficou de fora da lista de exceções do
// matcher e passou a responder 307 para /login.
//
// `importScripts` recusa redirect e recusa MIME que não seja JavaScript, então a
// avaliação do sw.js lançava inteira. Medido no navegador contra produção:
//
//   navigator.serviceWorker.register("/sw.js")
//   -> TypeError: ServiceWorker script evaluation failed
//
// Com o registro falhando, o handler de `activate` nunca roda — e é ele que
// apaga todo cache de nome diferente do atual. O "atelie-v1", com HTML de rota
// protegida gravado dentro, seguia servível para o próximo usuário do navegador.
// A troca de nome para atelie-v2 era exatamente a peça que purgaria isso.
//
// Os testes existentes não pegaram porque todos leem os arquivos do disco, onde
// eles sempre estiveram certos. O que faltava era cobrar a ENTREGA deles: um
// arquivo em public/ pode estar perfeito e mesmo assim nunca chegar ao browser.
// A falha é silenciosa do lado do servidor — /sw.js responde 200 até hoje.

const RAIZ = new URL("../../", import.meta.url);
const proxy = readFileSync(new URL("src/proxy.ts", RAIZ), "utf8");
const sw = readFileSync(new URL("public/sw.js", RAIZ), "utf8");

/** Erro de forma inesperada. Recusar alto é o ponto — ver comentário abaixo. */
function falhar(motivo: string): never {
  throw new Error(
    `${motivo}. Este teste lê a forma que src/proxy.ts e public/sw.js usam hoje; ` +
      `se ela mudou, ajuste o leitor em vez de deixá-lo devolver lista vazia.`,
  );
}

// A extração dos importScripts e a resolução do caminho moram em tests/lib para
// serem as MESMAS que o smoke test roda contra produção (tests/smoke/pwa-entrega.mjs).
// Duas cópias divergiriam, e a divergência apareceria como um dos dois ficando
// verde sozinho — o modo de falha que os dois existem para evitar.
export { scriptsImportados, pathnameServido };

/**
 * Devolve os padrões do array `matcher` de src/proxy.ts, com os escapes de
 * string do TypeScript já resolvidos — o arquivo escreve `"sw\\.js"`, e a regex
 * que o Next recebe é `sw\.js`.
 *
 * NÃO é um parser de TypeScript: entende a forma que este arquivo usa — um array
 * de literais de string com aspas duplas, mais linhas de comentário — e RECUSA o
 * resto em voz alta. Um leitor que devolvesse lista vazia diante do inesperado
 * deixaria este teste verde para sempre, que é precisamente o modo de falha que
 * ele existe para evitar.
 */
export function padroesDoMatcher(fonte: string): string[] {
  const ABRE = "matcher: [";
  const inicio = fonte.indexOf(ABRE);
  if (inicio === -1) falhar("não achei `matcher: [` em src/proxy.ts");

  const fim = fonte.indexOf("]", inicio + ABRE.length);
  if (fim === -1) falhar("`matcher: [` sem `]` correspondente");

  const corpo = fonte.slice(inicio + ABRE.length, fim);
  const semComentario = corpo
    .split("\n")
    .filter((linha) => !linha.trim().startsWith("//"))
    .join("\n");

  const LITERAL = /"(?:[^"\\]|\\.)*"/g;
  const literais = semComentario.match(LITERAL) ?? [];
  if (literais.length === 0) falhar("o `matcher` não tem nenhum literal de string");

  const resto = semComentario.replace(LITERAL, "").replace(/,/g, "").trim();
  if (resto !== "") falhar(`o \`matcher\` tem forma não suportada: ${JSON.stringify(resto)}`);

  return literais.map((literal) => JSON.parse(literal) as string);
}


/**
 * O proxy roda quando o pathname casa com algum padrão do matcher. Os padrões
 * deste projeto são regex ancoradas na raiz, forma que o path-to-regexp do Next
 * preserva — daí a âncora explícita aqui.
 */
export function proxyIntercepta(padroes: string[], pathname: string): boolean {
  return padroes.some((padrao) => new RegExp(`^${padrao}$`).test(pathname));
}

// O matcher real do commit 7395629, antes desta correção. É a entrada sintética
// que prova o vermelho: sem ele, um bug no leitor ou no predicado deixaria o
// assert principal verde sem nunca ter olhado para nada.
const MATCHER_ANTES_DO_FIX =
  "/((?!_next/static|_next/image|favicon.ico|sw\\.js|manifest\\.webmanifest|icons/|apple-icon|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)";

test("vermelho: o matcher de antes do fix intercepta o script importado", () => {
  assert.equal(
    proxyIntercepta([MATCHER_ANTES_DO_FIX], "/sw-rotas.js"),
    true,
    "o predicado não reconhece a falha real de 01/09/2026 — o assert principal seria vácuo",
  );
  assert.equal(
    proxyIntercepta([MATCHER_ANTES_DO_FIX], "/sw.js"),
    false,
    "sw.js já era exceção antes do fix; se der true, o predicado está errado",
  );
});

test("o predicado sabe dizer sim: rota protegida É interceptada", () => {
  // Sem isto, um predicado que respondesse `false` para tudo passaria no assert
  // principal sem verificar coisa alguma.
  const padroes = padroesDoMatcher(proxy);
  assert.equal(proxyIntercepta(padroes, "/transacoes"), true);
  assert.equal(proxyIntercepta(padroes, "/"), true);
});

test("suíte real: nenhum script importado pelo sw.js é interceptado pelo proxy", () => {
  const padroes = padroesDoMatcher(proxy);
  const importados = scriptsImportados(sw);

  assert.ok(
    importados.length > 0,
    "public/sw.js não importa nada — se o importScripts foi removido, remova este assert junto",
  );

  for (const caminho of importados) {
    // Resolvido contra a URL do service worker: é esse pathname que chega ao
    // servidor, e é ele que o matcher julga. Ver pathnameServido.
    const servido = pathnameServido(caminho);
    assert.equal(
      proxyIntercepta(padroes, servido),
      false,
      `${caminho} (servido em ${servido}) é interceptado pelo proxy: deslogado ele ` +
        `devolve o HTML de /login, importScripts lança, o service worker não instala ` +
        `e o cache da versão anterior nunca é purgado. Acrescente-o às exceções do ` +
        `matcher em src/proxy.ts.`,
    );
  }
});

test("ponto nas exceções do matcher é literal, não curinga", () => {
  // Dentro do grupo, o path-to-regexp do Next passa o conteúdo verbatim — é isso
  // que faz o negative lookahead funcionar —, então ponto sem escape vira
  // curinga e dispensa do proxy caminhos que ninguém pretendeu dispensar. Como o
  // proxy é quem exige sessão, dispensa acidental é checagem de auth perdida.
  const padroes = padroesDoMatcher(proxy);

  for (const impostor of ["/faviconXico", "/swXjs", "/sw-rotasXjs", "/manifestXwebmanifest"]) {
    assert.equal(
      proxyIntercepta(padroes, impostor),
      true,
      `${impostor} escapa do proxy: algum ponto do matcher está sem escape e virou curinga`,
    );
  }

  // Controle: os nomes de verdade continuam dispensados, senão o PWA quebra.
  for (const real of ["/favicon.ico", "/sw.js", "/sw-rotas.js", "/manifest.webmanifest"]) {
    assert.equal(proxyIntercepta(padroes, real), false, `${real} deixou de ser exceção`);
  }
});

test("o register não deixa os importScripts virem do cache HTTP", () => {
  // No padrão `updateViaCache: "imports"`, só o script de topo escapa do cache
  // HTTP; os importados vêm dele. O nome do cache — cujo bump é o que dispara a
  // purga no `activate` — mora justamente num script importado, então uma
  // resposta velha ali é purga que não acontece, em silêncio. Os headers da
  // Vercel hoje forçam revalidação, mas isso é configuração de plataforma, não
  // garantia do app.
  const registrador = readFileSync(
    new URL("src/components/registrar-service-worker.tsx", RAIZ),
    "utf8",
  );
  assert.match(
    registrador,
    /register\(\s*"\/sw\.js"\s*,\s*\{\s*updateViaCache:\s*"none"\s*\}\s*\)/,
    'register("/sw.js") sem `{ updateViaCache: "none" }`: os scripts importados ' +
      "podem vir do cache HTTP, e o bump do nome do cache não chega ao browser",
  );
});

test("vermelho: caminho relativo é resolvido antes de comparar, não julgado cru", () => {
  // Sem a resolução, o assert acima passaria por construção para qualquer forma
  // relativa de importScripts: nenhum literal sem "/" inicial casa com um padrão
  // que começa em "/". O guard ficaria verde com o bug presente.
  const padroes = padroesDoMatcher(proxy);

  assert.equal(pathnameServido("rotas/sw-rotas.js"), "/rotas/sw-rotas.js");
  assert.equal(pathnameServido("./sw-rotas.js"), "/sw-rotas.js");
  assert.equal(pathnameServido("/sw-rotas.js"), "/sw-rotas.js");

  assert.equal(
    proxyIntercepta(padroes, "rotas/sw-rotas.js"),
    false,
    "o literal cru não casa com padrão nenhum — é justamente por isso que julgá-lo cru engana",
  );
  assert.equal(
    proxyIntercepta(padroes, pathnameServido("rotas/sw-rotas.js")),
    true,
    "resolvido, /rotas/sw-rotas.js É interceptado: o assert principal precisa enxergar isso",
  );
});

test("o próprio sw.js e o manifest continuam fora do proxy", () => {
  // O registro do SW e a instalação do PWA acontecem antes de existir sessão.
  const padroes = padroesDoMatcher(proxy);
  assert.equal(proxyIntercepta(padroes, "/sw.js"), false);
  assert.equal(proxyIntercepta(padroes, "/manifest.webmanifest"), false);
});

test("vermelho: o leitor do matcher recusa forma inesperada em vez de devolver vazio", () => {
  assert.throws(() => padroesDoMatcher("export const config = {};"), /não achei/);
  assert.throws(() => padroesDoMatcher('const c = { matcher: ["/a"'), /sem `\]`/);
  assert.throws(() => padroesDoMatcher("const c = { matcher: [] };"), /nenhum literal/);
  assert.throws(
    () => padroesDoMatcher('const c = { matcher: [PADRAO_EXTERNO, "/a"] };'),
    /forma não suportada/,
  );
});

test("vermelho: importScripts com caminho dinâmico é recusado, não ignorado", () => {
  assert.throws(
    () => scriptsImportados('importScripts(`/sw-${versao}.js`);'),
    /argumento não literal/,
  );
  assert.equal(scriptsImportados("// nenhum import aqui").length, 0);
  assert.deepEqual(scriptsImportados('importScripts("/a.js", "/b.js");'), ["/a.js", "/b.js"]);
});
