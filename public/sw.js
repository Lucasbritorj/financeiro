// Service worker do PWA. Escopo deliberadamente pequeno:
//
// - Só intercepta GET da MESMA origem — nunca a origem do Supabase
//   (REST/RPC). Dado financeiro nunca é servido do cache; cachear resposta
//   de RPC (saldo, faturas) seria mostrar número desatualizado sem avisar.
// - Assets estáticos do Next (_next/static/*) são imutáveis (hash no nome):
//   cache-first, nunca precisam revalidar.
// - Navegação (documentos HTML): network-first — sempre tenta a rede
//   primeiro; cai pro cache só se a rede falhar (offline), como fallback
//   de "última tela vista", não como estratégia de velocidade.
// - Todo o resto passa direto (sem event.respondWith): SW não fica no
//   caminho de nada que ele não entende explicitamente.

const CACHE = "atelie-v1";
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
    event.respondWith(
      fetch(request)
        .then((resposta) => {
          caches.open(CACHE).then((cache) => cache.put(request, resposta.clone()));
          return resposta;
        })
        .catch(() => caches.match(request).then((r) => r ?? caches.match("/"))),
    );
  }
});
