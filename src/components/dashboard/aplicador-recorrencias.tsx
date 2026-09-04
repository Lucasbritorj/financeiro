"use client";

// Dispara aplicar_recorrencias() (0015) uma vez ao abrir o dashboard: as
// ocorrências vencidas viram transações e o usuário é avisado por toast.
// Substituto deliberado do pg_cron — a RPC precisa da sessão (auth.uid());
// atraso de dias sem abrir o app é recuperado retroativamente pelo laço.

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { mensagemDeErro } from "@/lib/erros";
import { useToast } from "@/components/feedback";
import { log } from "@/lib/log";

export default function AplicadorRecorrencias() {
  const router = useRouter();
  const notificar = useToast();
  // Uma chamada por montagem, mesmo sob StrictMode (efeito duplo em dev).
  const disparado = useRef(false);

  useEffect(() => {
    if (disparado.current) return;
    disparado.current = true;
    createClient()
      .rpc("aplicar_recorrencias")
      .then(({ data, error }) => {
        if (error) {
          // PGRST202 = RPC inexistente: migration 0015 ainda não aplicada.
          // Estado conhecido de instalação, não falha de runtime — sem toast
          // a cada visita; o aviso visível vive na seção Recorrências.
          if (error.code === "PGRST202") {
            log.aviso("aplicar_recorrencias indisponível: aplique a migration 0015.");
            return;
          }
          notificar(`Recorrências: ${mensagemDeErro(error)}`, "erro");
          return;
        }
        const res = data as { transacoes_criadas?: number; pendentes?: boolean } | null;
        const criadas = res?.transacoes_criadas ?? 0;
        if (criadas > 0) {
          notificar(
            `${criadas} lançamento(s) recorrente(s) aplicado(s)${res?.pendentes ? " — há mais pendentes, reabra o dashboard" : ""}.`,
            "sucesso",
          );
          router.refresh();
        }
      });
  }, [notificar, router]);

  return null;
}
