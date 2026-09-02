"use client";

import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function SairBotao() {
  const router = useRouter();

  // Apaga TODOS os caches, não só o do service worker: no logout não há nada
  // guardado que valha manter, e varrer por nome acoplaria este componente à
  // constante do sw-rotas.js. Roda antes do redirect e nunca derruba a saída —
  // Cache Storage falta em contexto inseguro e lança em navegador com dados de
  // site bloqueados; o usuário precisa sair de qualquer jeito.
  async function limparCaches() {
    try {
      if (typeof caches === "undefined") return;
      const nomes = await caches.keys();
      await Promise.all(nomes.map((n) => caches.delete(n)));
    } catch {
      // sem cache para limpar, ou acesso negado: seguir com o logout
    }
  }

  async function sair() {
    await createClient().auth.signOut();
    await limparCaches();
    router.push("/login");
    router.refresh();
  }

  return (
    <button
      onClick={sair}
      className="botao-fantasma text-xs"
    >
      Sair
    </button>
  );
}
