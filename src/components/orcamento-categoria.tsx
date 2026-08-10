"use client";

// Editor inline do envelope mensal da categoria (orçamento). A coluna e a
// RPC editar_categoria existem desde 0008 — isto é só a ponta de UI que
// faltava. A barra de progresso gasto/orçamento já vive no donut do
// dashboard e nos alertas da análise.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { formatarCentavos, paraCentavos, centavosParaDecimalEditavel } from "@/lib/money";
import { mensagemDeErro } from "@/lib/erros";
import { useToast } from "@/components/feedback";

export default function OrcamentoCategoria({
  categoriaId,
  nome,
  orcamento,
}: {
  categoriaId: string;
  nome: string;
  orcamento: number | null;
}) {
  const router = useRouter();
  const notificar = useToast();
  const [editando, setEditando] = useState(false);
  const [valor, setValor] = useState(
    orcamento != null ? centavosParaDecimalEditavel(orcamento) : "",
  );
  const [pendente, setPendente] = useState(false);

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    const limpar = valor.trim() === "";
    const centavos = limpar ? null : paraCentavos(valor);
    if (!limpar && !Number.isFinite(centavos)) {
      notificar("Valor de envelope inválido.", "erro");
      return;
    }
    setPendente(true);
    const { error } = await createClient().rpc("editar_categoria", {
      p_categoria_id: categoriaId,
      p_orcamento_mensal: centavos,
      p_limpar_orcamento: limpar,
    });
    setPendente(false);
    if (error) {
      notificar(mensagemDeErro(error), "erro");
      return;
    }
    notificar(
      limpar
        ? `Envelope de "${nome}" removido.`
        : `Envelope de "${nome}": ${formatarCentavos(centavos!)}/mês.`,
      "sucesso",
    );
    setEditando(false);
    router.refresh();
  }

  if (!editando) {
    return (
      <button
        type="button"
        className="botao-fantasma text-xs"
        onClick={() => setEditando(true)}
        title="Definir limite mensal de gasto (envelope) desta categoria"
      >
        {orcamento != null ? `envelope ${formatarCentavos(orcamento)}/mês` : "definir envelope"}
      </button>
    );
  }

  return (
    <form onSubmit={salvar} className="inline-flex items-center gap-2">
      <input
        value={valor}
        onChange={(e) => setValor(e.target.value)}
        inputMode="decimal"
        placeholder="ex.: 1200,00 · vazio remove"
        className="campo-soberano !mt-0 !w-40 py-1 text-xs"
        aria-label={`Envelope mensal de ${nome} em reais`}
        autoFocus
      />
      <button type="submit" disabled={pendente} className="botao-soberano px-3 py-1 text-xs">
        {pendente ? "..." : "Salvar"}
      </button>
      <button
        type="button"
        className="botao-fantasma px-2 py-1 text-xs"
        onClick={() => setEditando(false)}
      >
        Cancelar
      </button>
    </form>
  );
}
