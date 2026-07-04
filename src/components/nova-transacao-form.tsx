"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { paraCentavos } from "@/lib/money";

type CartaoOpcao = { id: string; nome: string };

function hojeSaoPaulo(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
  }).format(new Date());
}

export default function NovaTransacaoForm({ cartoes }: { cartoes: CartaoOpcao[] }) {
  const router = useRouter();
  const [descricao, setDescricao] = useState("");
  const [valor, setValor] = useState("");
  const [tipo, setTipo] = useState("DESPESA");
  const [forma, setForma] = useState("CREDITO");
  const [cartaoId, setCartaoId] = useState(cartoes[0]?.id ?? "");
  const [dataCompra, setDataCompra] = useState(hojeSaoPaulo);
  const [numParcelas, setNumParcelas] = useState("1");
  const [pendente, setPendente] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const ehCredito = forma === "CREDITO";

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);
    setOk(null);

    const centavos = paraCentavos(valor);
    if (!Number.isFinite(centavos)) {
      setErro("Valor inválido.");
      return;
    }
    if (ehCredito && !cartaoId) {
      setErro("Cadastre e selecione um cartão para lançar no crédito.");
      return;
    }

    setPendente(true);
    const supabase = createClient();
    // Toda escrita transacional passa pelo motor RPC (atomicidade + invariantes).
    const { data, error } = await supabase.rpc("processar_transacao_completa", {
      p_descricao: descricao.trim(),
      p_valor_total: centavos,
      p_tipo: tipo,
      p_forma_pagamento: forma,
      p_cartao_id: ehCredito ? cartaoId : null,
      p_data_compra: dataCompra,
      p_num_parcelas: ehCredito ? Number(numParcelas) : 1,
    });
    setPendente(false);

    if (error) {
      // hint carrega a remediação (padrão FW4xx do backend)
      setErro(error.hint ? `${error.message} ${error.hint}` : error.message);
      return;
    }
    const resultado = data as { parcelas_criadas?: number } | null;
    setOk(`Transação registrada: ${resultado?.parcelas_criadas ?? 1} parcela(s).`);
    setDescricao("");
    setValor("");
    setNumParcelas("1");
    router.refresh();
  }

  return (
    <form onSubmit={enviar} className="rounded-lg border border-zinc-200 bg-white p-4">
      <h2 className="mb-3 font-medium">Nova transação</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm sm:col-span-2">
          Descrição
          <input
            value={descricao}
            onChange={(e) => setDescricao(e.target.value)}
            required
            className="mt-1 w-full rounded border border-zinc-300 px-2 py-1.5"
            placeholder="Ex.: Mercado"
          />
        </label>
        <label className="text-sm">
          Valor (R$)
          <input
            value={valor}
            onChange={(e) => setValor(e.target.value)}
            required
            inputMode="decimal"
            className="mt-1 w-full rounded border border-zinc-300 px-2 py-1.5"
            placeholder="100,00"
          />
        </label>
        <label className="text-sm">
          Data da compra
          <input
            type="date"
            value={dataCompra}
            onChange={(e) => setDataCompra(e.target.value)}
            required
            className="mt-1 w-full rounded border border-zinc-300 px-2 py-1.5"
          />
        </label>
        <label className="text-sm">
          Tipo
          <select
            value={tipo}
            onChange={(e) => setTipo(e.target.value)}
            className="mt-1 w-full rounded border border-zinc-300 px-2 py-1.5"
          >
            <option value="DESPESA">Despesa</option>
            <option value="RECEITA">Receita</option>
          </select>
        </label>
        <label className="text-sm">
          Forma de pagamento
          <select
            value={forma}
            onChange={(e) => setForma(e.target.value)}
            className="mt-1 w-full rounded border border-zinc-300 px-2 py-1.5"
          >
            <option value="CREDITO">Crédito</option>
            <option value="DEBITO">Débito</option>
            <option value="PIX">Pix</option>
            <option value="DINHEIRO">Dinheiro</option>
          </select>
        </label>
        {ehCredito && (
          <>
            <label className="text-sm">
              Cartão
              <select
                value={cartaoId}
                onChange={(e) => setCartaoId(e.target.value)}
                className="mt-1 w-full rounded border border-zinc-300 px-2 py-1.5"
              >
                {cartoes.length === 0 && <option value="">Nenhum cartão cadastrado</option>}
                {cartoes.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nome}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              Parcelas
              <input
                type="number"
                min={1}
                max={48}
                value={numParcelas}
                onChange={(e) => setNumParcelas(e.target.value)}
                required
                className="mt-1 w-full rounded border border-zinc-300 px-2 py-1.5"
              />
            </label>
          </>
        )}
      </div>
      {erro && <p className="mt-2 text-sm text-red-600">{erro}</p>}
      {ok && <p className="mt-2 text-sm text-emerald-700">{ok}</p>}
      <button
        type="submit"
        disabled={pendente}
        className="mt-3 rounded bg-zinc-900 px-4 py-1.5 text-sm text-white hover:bg-zinc-700 disabled:opacity-50"
      >
        {pendente ? "Processando..." : "Registrar"}
      </button>
    </form>
  );
}
