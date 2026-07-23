"use client";

import { useEffect, useState } from "react";

// Alterna tema claro/escuro. O tema inicial é aplicado por script inline no
// layout (sem flash); aqui só sincronizamos o estado do botão e persistimos.
export default function TemaToggle() {
  const [claro, setClaro] = useState(false);

  useEffect(() => {
    // Sincroniza o botão com o atributo aplicado pelo script inline de tema.
    // É pós-hidratação DE PROPÓSITO: ler no init causaria mismatch de
    // hidratação (servidor não conhece o tema salvo). Exceção legítima à regra.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setClaro(document.documentElement.getAttribute("data-tema") === "claro");
  }, []);

  function alternar() {
    const novo = !claro;
    setClaro(novo);
    const raiz = document.documentElement;
    if (novo) raiz.setAttribute("data-tema", "claro");
    else raiz.removeAttribute("data-tema");
    try {
      localStorage.setItem("atelie-tema", novo ? "claro" : "escuro");
    } catch {
      /* localStorage indisponível: tema não persiste, mas alterna na sessão */
    }
  }

  return (
    <button
      type="button"
      onClick={alternar}
      className="grid h-8 w-8 place-items-center rounded-full border text-sm transition-colors"
      style={{ borderColor: "var(--borda)", color: "var(--grafite)" }}
      aria-label={claro ? "Mudar para tema escuro" : "Mudar para tema claro"}
      title={claro ? "Tema escuro" : "Tema claro"}
    >
      {claro ? "☾" : "☀"}
    </button>
  );
}
