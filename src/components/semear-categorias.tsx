"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { mensagemDeErro } from "@/lib/erros";

// Onboarding leve: usuário sem categoria vê um convite (não placeholder
// morto) para semear o conjunto padrão + regras de comerciante (0008).
export default function SemearCategorias() {
  const router = useRouter();
  const [pendente, setPendente] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function semear() {
    setErro(null);
    setPendente(true);
    const { error } = await createClient().rpc("seed_categorias_padrao");
    setPendente(false);
    if (error) {
      setErro(mensagemDeErro(error));
      return;
    }
    router.refresh();
  }

  return (
    <section
      className="vidro-soberano flex flex-col gap-3 p-6"
      style={{
        background:
          "radial-gradient(130% 120% at 100% 0%, rgba(217,162,78,.10), transparent 60%), var(--pergaminho)",
      }}
    >
      <h2 className="serifa text-lg font-medium">Comece com categorias prontas</h2>
      <p className="max-w-[52ch] text-sm" style={{ color: "var(--grafite)" }}>
        Criamos um conjunto quente de categorias (Moradia, Mercado, Delivery…) e
        algumas regras de comerciante — assim o app já classifica IFOOD, Uber ou
        farmácia sozinho. Você ajusta tudo depois.
      </p>
      <div className="flex items-center gap-3">
        <button onClick={semear} disabled={pendente} className="botao-soberano text-sm">
          {pendente ? "Criando..." : "Criar categorias padrão"}
        </button>
        {erro && (
          <span className="text-xs" style={{ color: "var(--telha)" }}>
            {erro}
          </span>
        )}
      </div>
    </section>
  );
}
