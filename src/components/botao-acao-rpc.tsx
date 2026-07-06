"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { mensagemDeErro } from "@/lib/erros";

// Ações de escrita disponíveis na UI — toda mutação passa pelas RPCs
// atômicas (convenção do projeto). União discriminada mantém o chamador
// tipado; o cast fica confinado à chamada genérica do supabase-js.
export type AcaoRpc =
  | { rpc: "processar_pagamento_fatura"; args: { p_fatura_id: string } }
  | { rpc: "excluir_transacao"; args: { p_transacao_id: string } }
  | { rpc: "excluir_cartao"; args: { p_cartao_id: string } };

export default function BotaoAcaoRpc({
  acao,
  rotulo,
  rotuloPendente,
  confirmacao,
  perigo = false,
}: {
  acao: AcaoRpc;
  rotulo: string;
  rotuloPendente: string;
  confirmacao?: string;
  perigo?: boolean;
}) {
  const router = useRouter();
  const [pendente, setPendente] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function executar() {
    if (confirmacao && !window.confirm(confirmacao)) return;
    setErro(null);
    setPendente(true);
    const { error } = await createClient().rpc(
      acao.rpc,
      acao.args as never // FW4xx do backend cobre qualquer arg inválido
    );
    setPendente(false);
    if (error) {
      setErro(mensagemDeErro(error));
      return;
    }
    router.refresh();
  }

  return (
    <span className="inline-flex items-center gap-2">
      <button
        onClick={executar}
        disabled={pendente}
        className={`botao-fantasma text-xs ${perigo ? "botao-perigo" : ""}`}
      >
        {pendente ? rotuloPendente : rotulo}
      </button>
      {erro && (
        <span className="text-xs" style={{ color: "var(--acento-negativo)" }}>
          {erro}
        </span>
      )}
    </span>
  );
}
