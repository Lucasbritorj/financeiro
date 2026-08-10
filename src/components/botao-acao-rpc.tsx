"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { mensagemDeErro } from "@/lib/erros";
import { useToast, useConfirm } from "@/components/feedback";

// Ações de escrita disponíveis na UI — toda mutação passa pelas RPCs
// atômicas (convenção do projeto). União discriminada mantém o chamador
// tipado; o cast fica confinado à chamada genérica do supabase-js.
export type AcaoRpc =
  | { rpc: "processar_pagamento_fatura"; args: { p_fatura_id: string } }
  | { rpc: "estornar_pagamento_fatura"; args: { p_fatura_id: string } }
  | { rpc: "pagar_boleto"; args: { p_transacao_id: string } }
  | { rpc: "estornar_boleto"; args: { p_transacao_id: string } }
  | { rpc: "duplicar_boleto"; args: { p_transacao_id: string; p_meses?: number } }
  | { rpc: "excluir_transacao"; args: { p_transacao_id: string } }
  | { rpc: "excluir_cartao"; args: { p_cartao_id: string } }
  | { rpc: "excluir_categoria"; args: { p_categoria_id: string } }
  | { rpc: "excluir_regra_categorizacao"; args: { p_regra_id: string } }
  | { rpc: "confirmar_importacao"; args: { p_importacao_id: string } }
  | { rpc: "descartar_importacao"; args: { p_importacao_id: string } }
  | { rpc: "arquivar_cofrinho"; args: { p_cofrinho_id: string; p_arquivado?: boolean } };

export default function BotaoAcaoRpc({
  acao,
  rotulo,
  rotuloPendente,
  confirmacao,
  tituloConfirmacao,
  sucesso,
  perigo = false,
}: {
  acao: AcaoRpc;
  rotulo: string;
  rotuloPendente: string;
  confirmacao?: string;
  tituloConfirmacao?: string;
  sucesso?: string;
  perigo?: boolean;
}) {
  const router = useRouter();
  const notificar = useToast();
  const confirmar = useConfirm();
  const [pendente, setPendente] = useState(false);

  async function executar() {
    if (confirmacao) {
      const ok = await confirmar({
        mensagem: confirmacao,
        titulo: tituloConfirmacao ?? rotulo,
        rotuloConfirmar: rotulo,
        perigo,
      });
      if (!ok) return;
    }
    setPendente(true);
    const { error } = await createClient().rpc(
      acao.rpc,
      acao.args as never // FW4xx do backend cobre qualquer arg inválido
    );
    setPendente(false);
    if (error) {
      notificar(mensagemDeErro(error), "erro");
      return;
    }
    notificar(sucesso ?? "Feito.", "sucesso");
    router.refresh();
  }

  return (
    <button
      onClick={executar}
      disabled={pendente}
      className={`botao-fantasma text-xs ${perigo ? "botao-perigo" : ""}`}
    >
      {pendente ? rotuloPendente : rotulo}
    </button>
  );
}
