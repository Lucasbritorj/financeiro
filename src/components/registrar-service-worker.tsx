"use client";

import { useEffect } from "react";
import { log } from "@/lib/log";

/** Registra o service worker do PWA. Sem UI — só efeito colateral no mount. */
export function RegistrarServiceWorker() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    // `updateViaCache: "none"` faz o browser buscar da rede TANTO o sw.js quanto
    // os scripts que ele carrega por importScripts. No padrão ("imports"), só o
    // script de topo escapa do cache HTTP — os importados vêm do cache, e é num
    // deles (public/sw-rotas.js) que mora o nome do cache cujo bump dispara a
    // purga no `activate`. Uma resposta velha ali significa purga que não
    // acontece, sem erro nenhum.
    //
    // Hoje os dois vêm com `Cache-Control: max-age=0, must-revalidate` da Vercel,
    // o que já força revalidação. Isso é configuração de plataforma, não garantia
    // do app: se o header mudar, o padrão volta a morder em silêncio. Declarar
    // aqui não depende de header nenhum.
    navigator.serviceWorker.register("/sw.js", { updateViaCache: "none" }).catch((erro) => {
      log.erro("Falha ao registrar service worker:", erro);
    });
  }, []);

  return null;
}
