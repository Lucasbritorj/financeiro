"use client";

import { useEffect } from "react";

/** Registra o service worker do PWA. Sem UI — só efeito colateral no mount. */
export function RegistrarServiceWorker() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch((erro) => {
      console.error("Falha ao registrar service worker:", erro);
    });
  }, []);

  return null;
}
