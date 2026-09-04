// Leitura dos `importScripts` de um service worker, compartilhada por dois
// consumidores que olham para lugares diferentes:
//
// - tests/unit/sw-entregavel.test.ts   -> lê o sw.js do DISCO e confere contra o
//                                         matcher do proxy (gate, roda no CI)
// - tests/smoke/pwa-entrega.mjs        -> lê o sw.js de uma URL REAL e confere a
//                                         entrega de verdade (roda contra produção)
//
// Mora aqui para os dois usarem exatamente a mesma extração. Duas cópias da
// regex divergiriam, e a divergência apareceria como um dos dois ficando verde
// sozinho — que é o modo de falha que ambos existem para evitar.

/** Erro de forma inesperada. Recusar alto é o ponto: ver comentário abaixo. */
export function falhar(motivo) {
  throw new Error(
    `${motivo}. Este leitor entende a forma que o sw.js usa hoje; se ela mudou, ` +
      `ajuste-o em vez de deixá-lo devolver lista vazia.`,
  );
}

const LITERAL = /"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g;

/**
 * Devolve os caminhos que o service worker carrega por `importScripts`.
 * Argumento que não seja literal de string é recusado: um caminho montado em
 * runtime não é verificável estaticamente, e fingir que não existe seria pior.
 *
 * @param {string} fonteSw
 * @returns {string[]}
 */
export function scriptsImportados(fonteSw) {
  const chamadas = fonteSw.match(/importScripts\s*\(([^)]*)\)/g) ?? [];
  if (chamadas.length === 0) return [];

  const caminhos = [];
  for (const chamada of chamadas) {
    const args = chamada.slice(chamada.indexOf("(") + 1, chamada.lastIndexOf(")"));
    const literais = args.match(LITERAL) ?? [];
    const semLiteral = args.replace(LITERAL, "");
    if (semLiteral.replace(/,/g, "").trim() !== "") {
      falhar(`importScripts com argumento não literal: ${chamada}`);
    }
    for (const literal of literais) caminhos.push(literal.slice(1, -1));
  }
  return caminhos;
}

/**
 * O pathname que o servidor recebe quando o service worker importa `caminho`.
 *
 * `importScripts` resolve o argumento contra a URL do PRÓPRIO service worker, e
 * não contra a raiz do site: `"rotas/sw-rotas.js"` dentro de /sw.js é buscado em
 * /rotas/sw-rotas.js. Julgar o literal cru seria falso verde garantido para toda
 * forma relativa — todo padrão de matcher começa em "/", e literal relativo
 * nunca casa com ele.
 *
 * @param {string} caminho
 * @param {string} urlDoSw
 * @returns {string}
 */
export function pathnameServido(caminho, urlDoSw = "https://exemplo.invalid/sw.js") {
  return new URL(caminho, urlDoSw).pathname;
}

/**
 * A URL absoluta de um script importado, para buscar de verdade.
 * @param {string} caminho
 * @param {string} urlDoSw URL absoluta do service worker
 * @returns {string}
 */
export function urlImportada(caminho, urlDoSw) {
  return new URL(caminho, urlDoSw).toString();
}
