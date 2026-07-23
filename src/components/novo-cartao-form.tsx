"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { paraCentavos } from "@/lib/money";
import { mensagemDeErro } from "@/lib/erros";

export default function NovoCartaoForm() {
  const router = useRouter();
  const [nome, setNome] = useState("");
  const [limite, setLimite] = useState("");
  const [diaFechamento, setDiaFechamento] = useState("1");
  const [diaVencimento, setDiaVencimento] = useState("10");
  const [pendente, setPendente] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);

    const limiteCentavos = paraCentavos(limite);
    if (!Number.isFinite(limiteCentavos)) {
      setErro("Limite inválido.");
      return;
    }

    setPendente(true);
    const supabase = createClient();
    // Escrita direta é revogada no banco (0005): cartão nasce pela RPC,
    // que valida e resolve o usuário via auth.uid().
    const { error } = await supabase.rpc("criar_cartao", {
      p_nome: nome.trim(),
      p_limite_total: limiteCentavos,
      p_dia_fechamento: Number(diaFechamento),
      p_dia_vencimento: Number(diaVencimento),
    });
    setPendente(false);

    if (error) {
      setErro(mensagemDeErro(error));
      return;
    }
    setNome("");
    setLimite("");
    router.refresh();
  }

  return (
    <form onSubmit={enviar} className="vidro-soberano p-4">
      <h2 className="mb-3 font-medium">Novo cartão</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm">
          Nome
          <input
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            required
            className="campo-soberano"
            placeholder="Ex.: Nubank"
          />
        </label>
        <label className="text-sm">
          Limite (R$)
          <input
            value={limite}
            onChange={(e) => setLimite(e.target.value)}
            required
            inputMode="decimal"
            className="campo-soberano"
            placeholder="5.000,00"
          />
        </label>
        <label className="text-sm">
          Dia de fechamento
          <input
            type="number"
            min={1}
            max={31}
            value={diaFechamento}
            onChange={(e) => setDiaFechamento(e.target.value)}
            required
            className="campo-soberano"
          />
        </label>
        <label className="text-sm">
          Dia de vencimento
          <input
            type="number"
            min={1}
            max={31}
            value={diaVencimento}
            onChange={(e) => setDiaVencimento(e.target.value)}
            required
            className="campo-soberano"
          />
        </label>
      </div>
      {erro && <p className="mt-2 text-sm" style={{ color: "var(--telha)" }}>{erro}</p>}
      <button
        type="submit"
        disabled={pendente}
        className="botao-soberano mt-3 text-sm"
      >
        {pendente ? "Salvando..." : "Salvar cartão"}
      </button>
    </form>
  );
}
