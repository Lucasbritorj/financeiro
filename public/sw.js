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
          // `resposta.ok` importa aqui pelo mesmo motivo da branch de assets:
          // fetch só rejeita em falha de rede, então um 500 durante deploy
          // resolveria normalmente e gravaria a página de erro como se fosse
          // a "última tela boa" — que é justamente o que o fallback promete.
          if (cacheavel && resposta.ok) {
            caches.open(CACHE).then((cache) => cache.put(request, resposta.clone()));
          }
          return resposta;
        })
        // Rota protegida não tem fallback de cache: preferimos o erro de rede
        // a servir o HTML de outra sessão. `caches.match("/")` é seguro porque
        // "/" é público.
        .catch(() =>
          cacheavel
            ? caches.match(request).then((r) => r ?? caches.match("/"))
            : caches.match("/"),
        ),
    );
  }
});
