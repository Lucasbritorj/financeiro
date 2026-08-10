"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { paraCentavos } from "@/lib/money";
import { mensagemDeErro } from "@/lib/erros";

// Paleta Ateliê para a cor da categoria (mesma do seed 0008).
const CORES = [
  "#D9A24E", "#7CB49A", "#D6674E", "#C98A5B",
  "#A67C8B", "#8B9BB0", "#B0A15B", "#A69C8D",
];

export default function NovaCategoriaForm() {
  const router = useRouter();
  const [nome, setNome] = useState("");
  const [tipo, setTipo] = useState("DESPESA");
  const [cor, setCor] = useState(CORES[0]);
  const [orcamento, setOrcamento] = useState("");
  const [pendente, setPendente] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);

    let orcamentoCentavos: number | null = null;
    if (orcamento.trim() !== "") {
      const c = paraCentavos(orcamento);
      if (!Number.isFinite(c)) {
        setErro("Orçamento inválido.");
        return;
      }
      orcamentoCentavos = c;
    }

    setPendente(true);
    const { error } = await createClient().rpc("criar_categoria", {
      p_nome: nome.trim(),
      p_cor: cor,
      p_tipo: tipo,
      p_orcamento_mensal: orcamentoCentavos,
    });
    setPendente(false);
    if (error) {
      setErro(mensagemDeErro(error));
      return;
    }
    setNome("");
    setOrcamento("");
    router.refresh();
  }

  return (
    <form onSubmit={enviar} className="vidro-soberano p-4">
      <h2 className="mb-3 font-medium">Nova categoria</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm sm:col-span-2">
          Nome
          <input
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            required
            className="campo-soberano"
            placeholder="Ex.: Delivery"
          />
        </label>
        <label className="text-sm">
          Tipo
          <select value={tipo} onChange={(e) => setTipo(e.target.value)} className="campo-soberano">
            <option value="DESPESA">Despesa</option>
            <option value="RECEITA">Receita</option>
          </select>
        </label>
        <label className="text-sm">
          Orçamento mensal (R$) · opcional
          <input
            value={orcamento}
            onChange={(e) => setOrcamento(e.target.value)}
            inputMode="decimal"
            className="campo-soberano"
            placeholder="350,00"
          />
        </label>
        <fieldset className="text-sm sm:col-span-2">
          <legend className="mb-1">Cor</legend>
          <div className="flex flex-wrap gap-2">
            {CORES.map((c) => (
              <button
                type="button"
                key={c}
                onClick={() => setCor(c)}
                aria-label={`Cor ${c}`}
                aria-pressed={cor === c}
                className="h-7 w-7 rounded-full"
                style={{
                  background: c,
                  outline: cor === c ? "2px solid var(--giz)" : "none",
                  outlineOffset: "2px",
                }}
              />
            ))}
          </div>
        </fieldset>
      </div>
      {erro && (
        <p className="mt-2 text-sm" style={{ color: "var(--telha)" }}>
          {erro}
        </p>
      )}
      <button type="submit" disabled={pendente} className="botao-soberano mt-3 text-sm">
        {pendente ? "Salvando..." : "Salvar categoria"}
      </button>
    </form>
  );
}
