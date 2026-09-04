// Smoke test da ENTREGA do PWA contra uma URL real.
//
//   node tests/smoke/pwa-entrega.mjs https://financeiro-seven-gamma.vercel.app
//   npm run smoke -- https://financeiro-seven-gamma.vercel.app
//
// POR QUE ISTO EXISTE, E POR QUE NÃO É MAIS UM TESTE UNITÁRIO
//
// Em 02/09/2026 a correção do vazamento do service worker ficou ~12h em produção
// sem efeito nenhum, e nada acusou. O sw.js estava certo no disco, o CI estava
// verde e o arquivo era servido em 200 — mas o /sw-rotas.js, que ele carrega por
// importScripts, batia no proxy de sessão e respondia 307 para /login.
// `importScripts` recusa redirect e recusa MIME que não seja JavaScript, então a
// avaliação do service worker inteiro lançava e ele nunca instalava.
//
// tests/unit/sw-entregavel.test.ts fecha essa classe ANTES do deploy, lendo o
// matcher do proxy. Este smoke fecha o outro lado: o que o servidor REALMENTE
// entrega. Um teste que lê o disco não vê redirect de proxy, header errado,
// regra de CDN, rewrite de plataforma ou deploy que subiu pela metade.
//
// NÃO roda no CI do push: o CI roda ANTES do deploy, então mediria a versão
// anterior e daria uma resposta sobre o passado. É para rodar DEPOIS do deploy —
// à mão, ou por um job disparado por deployment_status.
//
// Sai 0 se tudo passa, 1 na primeira falha, com o motivo. Só faz GET.

import { scriptsImportados, urlImportada } from "../lib/sw-importscripts.mjs";

const MIME_JS = /^(application|text)\/javascript\b/;
const MIME_MANIFEST = /^application\/manifest\+json\b/;

const base = process.argv[2] ?? process.env.SMOKE_URL;
if (!base) {
  console.error(
    "uso: node tests/smoke/pwa-entrega.mjs <url-base>\n" +
      "     (ou SMOKE_URL=<url-base> npm run smoke)",
  );
  process.exit(2);
}

const raiz = new URL(base).origin;
const falhas = [];
const ok = [];

/**
 * Busca sem seguir redirect. `redirect: "manual"` é o ponto do teste inteiro:
 * seguindo o redirect, um 307 para /login viraria um 200 com HTML de login e
 * passaria despercebido — foi exatamente assim que o bug se escondeu.
 */
async function conferir(url, mimeEsperado, rotulo) {
  let res;
  try {
    // `connection: close` evita que o keep-alive do fetch segure sockets vivos
    // no fim do processo — ver o comentário sobre exitCode no rodapé.
    res = await fetch(url, {
      redirect: "manual",
      headers: { "cache-control": "no-cache", connection: "close" },
    });
  } catch (erro) {
    falhas.push(`${rotulo} (${url}): a requisição falhou — ${erro.message}`);
    return null;
  }

  if (res.status >= 300 && res.status < 400) {
    falhas.push(
      `${rotulo} (${url}): responde ${res.status} -> ${res.headers.get("location")}. ` +
        `Precisa ser servido sem redirect a quem não tem sessão; confira as exceções ` +
        `do matcher em src/proxy.ts.`,
    );
    return null;
  }
  if (res.status !== 200) {
    falhas.push(`${rotulo} (${url}): responde ${res.status}, esperado 200.`);
    return null;
  }

  const mime = res.headers.get("content-type") ?? "";
  if (!mimeEsperado.test(mime)) {
    falhas.push(
      `${rotulo} (${url}): content-type "${mime}" não bate com ${mimeEsperado}. ` +
        `importScripts recusa MIME que não seja JavaScript.`,
    );
    return null;
  }

  ok.push(`${rotulo}: 200 ${mime.split(";")[0]}`);
  return res;
}

const urlSw = `${raiz}/sw.js`;
console.log(`smoke da entrega do PWA em ${raiz}\n`);

const resSw = await conferir(urlSw, MIME_JS, "service worker /sw.js");

if (resSw) {
  const fonte = await resSw.text();
  let importados;
  try {
    importados = scriptsImportados(fonte);
  } catch (erro) {
    falhas.push(`não consegui ler os importScripts do sw.js servido: ${erro.message}`);
    importados = [];
  }

  if (importados.length === 0) {
    // Não é falha: um sw.js sem importScripts é legítimo. Mas dizer em voz alta
    // evita que este smoke passe por vácuo depois de uma refatoração.
    console.log("aviso: o sw.js servido não importa nenhum script — nada a conferir aqui.\n");
  }

  for (const caminho of importados) {
    await conferir(urlImportada(caminho, urlSw), MIME_JS, `importScripts ${caminho}`);
  }
}

await conferir(`${raiz}/manifest.webmanifest`, MIME_MANIFEST, "manifest");

for (const linha of ok) console.log(`  ok      ${linha}`);
for (const linha of falhas) console.log(`  FALHOU  ${linha}`);

console.log("");
if (falhas.length > 0) {
  console.error(
    `smoke VERMELHO: ${falhas.length} de ${ok.length + falhas.length} verificações falharam.\n` +
      `O service worker não vai instalar neste ambiente, e o handler de activate — ` +
      `que purga o cache da versão anterior — não roda.`,
  );
  // `process.exitCode`, e NÃO `process.exit(1)`. Com sockets do fetch ainda
  // abertos, o exit abrupto derruba o Node no Windows com
  // "Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)" e o código vira
  // 127 — que um CI lê como "comando não encontrado", não como "smoke falhou".
  // Medido neste projeto em 02/09/2026. Assim o processo termina sozinho e sai 1.
  process.exitCode = 1;
} else {
  console.log(`smoke verde: ${ok.length} verificações, tudo entregue como o browser precisa.`);
}
