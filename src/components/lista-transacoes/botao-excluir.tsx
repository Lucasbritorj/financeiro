"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { mensagemDeErro } from "@/lib/erros";
import { useToast, useConfirm } from "@/components/feedback";

export function BotaoExcluir({
  id,
  descricao,
  aoExcluir,
}: {
  id: string;
  descricao: string;
  aoExcluir: (id: string) => void;
}) {
  const router = useRouter();
  const notificar = useToast();
  const confirmar = useConfirm();
  const [pendente, setPendente] = useState(false);

  async function excluir() {
    const ok = await confirmar({
      titulo: "Excluir transação",
      mensagem: `Excluir "${descricao}"? Parcelas pendentes saem das faturas.`,
      rotuloConfirmar: "Excluir",
      perigo: true,
    });
    if (!ok) return;
    setPendente(true);
    const { error } = await createClient().rpc("excluir_transacao", { p_transacao_id: id });
    setPendente(false);
    if (error) {
      notificar(mensagemDeErro(error), "erro");
      return;
    }
    notificar("Transação excluída.", "sucesso");
    aoExcluir(id);
    router.refresh();
  }

  return (
    <button
      type="button"
      onClick={excluir}
      disabled={pendente}
      className="botao-fantasma botao-perigo text-xs"
    >
      {pendente ? "Excluindo..." : "Excluir"}
    </button>
  );
}
