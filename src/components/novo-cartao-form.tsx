"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { paraCentavos } from "@/lib/money";

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
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setPendente(false);
      setErro("Sessão expirada. Entre novamente.");
      return;
    }

    const { error } = await supabase.from("cartoes_credito").insert({
      user_id: user.id,
      nome: nome.trim(),
      limite_total: limiteCentavos,
      dia_fechamento: Number(diaFechamento),
      dia_vencimento: Number(diaVencimento),
    });
    setPendente(false);

    if (error) {
      setErro(error.message);
      return;
    }
    setNome("");
    setLimite("");
    router.refresh();
  }

  return (
    <form onSubmit={enviar} className="rounded-lg border border-zinc-200 bg-white p-4">
      <h2 className="mb-3 font-medium">Novo cartão</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm">
          Nome
          <input
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            required
            className="mt-1 w-full rounded border border-zinc-300 px-2 py-1.5"
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
            className="mt-1 w-full rounded border border-zinc-300 px-2 py-1.5"
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
            className="mt-1 w-full rounded border border-zinc-300 px-2 py-1.5"
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
            className="mt-1 w-full rounded border border-zinc-300 px-2 py-1.5"
          />
        </label>
      </div>
      {erro && <p className="mt-2 text-sm text-red-600">{erro}</p>}
      <button
        type="submit"
        disabled={pendente}
        className="mt-3 rounded bg-zinc-900 px-4 py-1.5 text-sm text-white hover:bg-zinc-700 disabled:opacity-50"
      >
        {pendente ? "Salvando..." : "Salvar cartão"}
      </button>
    </form>
  );
}
