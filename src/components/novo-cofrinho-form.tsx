"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { paraCentavos } from "@/lib/money";
import { mensagemDeErro } from "@/lib/erros";

export default function NovoCofrinhoForm() {
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const [nome, setNome] = useState("");
  const [alvo, setAlvo] = useState("");
  const [horizonte, setHorizonte] = useState("MEDIO");
  const [dataAlvo, setDataAlvo] = useState("");
  const [pendente, setPendente] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);
    const centavos = paraCentavos(alvo);
    if (!Number.isFinite(centavos)) {
      setErro("Valor-alvo inválido.");
      return;
    }
    setPendente(true);
    const { error } = await createClient().rpc("criar_cofrinho", {
      p_nome: nome.trim(),
      p_valor_alvo: centavos,
      p_horizonte: horizonte,
      p_data_alvo: dataAlvo || null,
    });
    setPendente(false);
    if (error) {
      setErro(mensagemDeErro(error));
      return;
    }
    setNome("");
    setAlvo("");
    setDataAlvo("");
    setAberto(false);
    router.refresh();
  }

  if (!aberto) {
    return (
      <button
        onClick={() => setAberto(true)}
        className="w-full rounded-xl border border-dashed p-3 text-sm transition-colors"
        style={{ borderColor: "var(--borda-forte)", color: "var(--grafite)" }}
      >
        + Novo cofrinho
      </button>
    );
  }

  return (
    <form onSubmit={enviar} className="vidro-soberano grid gap-3 p-5 sm:grid-cols-2">
      <label className="text-sm sm:col-span-2">
        Nome
        <input
          value={nome}
          onChange={(e) => setNome(e.target.value)}
          required
          className="campo-soberano"
          placeholder="Ex.: Reserva de emergência"
        />
      </label>
      <label className="text-sm">
        Valor-alvo (R$)
        <input
          value={alvo}
          onChange={(e) => setAlvo(e.target.value)}
          required
          inputMode="decimal"
          className="campo-soberano"
          placeholder="18.000,00"
        />
      </label>
      <label className="text-sm">
        Horizonte
        <select
          value={horizonte}
          onChange={(e) => setHorizonte(e.target.value)}
          className="campo-soberano"
        >
          <option value="CURTO">Curto prazo</option>
          <option value="MEDIO">Médio prazo</option>
          <option value="LONGO">Longo prazo</option>
        </select>
      </label>
      <label className="text-sm sm:col-span-2">
        Data-alvo · opcional
        <input
          type="date"
          value={dataAlvo}
          onChange={(e) => setDataAlvo(e.target.value)}
          className="campo-soberano"
        />
      </label>
      {erro && (
        <p className="text-sm sm:col-span-2" style={{ color: "var(--telha)" }}>
          {erro}
        </p>
      )}
      <div className="flex gap-3 sm:col-span-2">
        <button type="submit" disabled={pendente} className="botao-soberano text-sm">
          {pendente ? "Criando..." : "Criar cofrinho"}
        </button>
        <button type="button" onClick={() => setAberto(false)} className="botao-fantasma text-sm">
          Cancelar
        </button>
      </div>
    </form>
  );
}
