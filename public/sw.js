// Service worker do PWA. Escopo deliberadamente pequeno:
//
// - Só intercepta GET da MESMA origem — nunca a origem do Supabase
//   (REST/RPC). Dado financeiro nunca é servido do cache; cachear resposta
//   de RPC (saldo, faturas) seria mostrar número desatualizado sem avisar.
// - Assets estáticos do Next (_next/static/*) são imutáveis (hash no nome):
//   cache-first, nunca precisam revalidar.
// - Navegação (documentos HTML): network-first — sempre tenta a rede
//   primeiro; cai pro cache só se a rede falhar (offline), como fallback
//   de "última tela vista", não como estratégia de velocidade. E SÓ para
//   rota pública: o HTML de (protegido) é SSR com os dados do usuário
//   dentro, e o Cache Storage não separa por sessão — ver sw-rotas.js.
// - Todo o resto passa direto (sem event.respondWith): SW não fica no
//   caminho de nada que ele não entende explicitamente.

importScripts("/sw-rotas.js");

const CACHE = self.SWRotas.NOME_CACHE;
const podeCachearNavegacao = self.SWRotas.podeCachearNavegacao;
const podeGravarNavegacao = self.SWRotas.podeGravarNavegacao;
const ASSETS_ESTATICOS = /^\/_next\/static\//;

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((chaves) =>
      Promise.all(chaves.filter((c) => c !== CACHE).map((c) => caches.delete(c))),
    ),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // nunca intercepta o Supabase

  if (ASSETS_ESTATICOS.test(url.pathname)) {
    event.respondWith(
      caches.open(CACHE).then(async (cache) => {
        const emCache = await cache.match(request);
        if (emCache) return emCache;
        const resposta = await fetch(request);
        if (resposta.ok) cache.put(request, resposta.clone());
        return resposta;
      }),
    );
    return;
  }

  if (request.mode === "navigate") {
    const cacheavel = podeCachearNavegacao(url.pathname);
    event.respondWith(
      fetch(request)
        .then((resposta) => {
          // A decisão inteira mora em sw-rotas.js, para o teste executá-la com
          // respostas sintéticas em vez de procurar este `if` no texto do
          // arquivo. Ver podeGravarNavegacao para o porquê de cada condição —
          // em especial `!redirected`, que é o que impede o HTML de /transacoes
          // de ser gravado sob a chave "/" ou "/login".
          if (podeGravarNavegacao(url.pathname, resposta)) {
            caches.open(CACHE).then((cache) => cache.put(request, resposta.clone()));
          }
          return resposta;
        })
        // Rota protegida não tem fallback de cache: preferimos o erro de rede a
        // servir o HTML de outra sessão. `caches.match("/")` não devolve nada
        // hoje — "/" só responde por redirect e, com a checagem acima, nunca é
        // gravado. Fica como fallback para o dia em que "/" servir uma página
        // pública própria; até lá, resolve undefined e a navegação falha, que é
        // o comportamento correto para rota protegida offline.
        .catch(() =>
          cacheavel
            ? caches.match(request).then((r) => r ?? caches.match("/"))
            : caches.match("/"),
        ),
    );
  }
});
