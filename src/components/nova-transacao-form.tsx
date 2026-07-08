"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { paraCentavos } from "@/lib/money";
import { mensagemDeErro } from "@/lib/erros";
import { MAX_PARCELAS_UI } from "@/lib/constantes";

type CartaoOpcao = { id: string; nome: string };
type CategoriaOpcao = { id: string; nome: string; tipo: string };

function hojeSaoPaulo(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
  }).format(new Date());
}

export default function NovaTransacaoForm({
  cartoes,
  categorias = [],
}: {
  cartoes: CartaoOpcao[];
  categorias?: CategoriaOpcao[];
}) {
  const router = useRouter();
  const [descricao, setDescricao] = useState("");
  const [valor, setValor] = useState("");
  const [tipo, setTipo] = useState("DESPESA");
  const [forma, setForma] = useState("CREDITO");
  const [cartaoId, setCartaoId] = useState(cartoes[0]?.id ?? "");
  const [categoriaId, setCategoriaId] = useState("");
  const [dataCompra, setDataCompra] = useState(hojeSaoPaulo);
  const [numParcelas, setNumParcelas] = useState("1");
  const [pendente, setPendente] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const ehCredito = forma === "CREDITO";
  // Categoria vazia => trigger de autocategorização (0008) decide pela regra.
  const categoriasDoTipo = categorias.filter((c) => c.tipo === tipo);

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

    if (error) {
      setPendente(false);
      setErro(mensagemDeErro(error));
      return;
    }
    const resultado = data as { transacao_id?: string; parcelas_criadas?: number } | null;

    // Categoria escolhida à mão prevalece sobre a autocategorização por
    // regra (trigger 0008); vazio = deixa a regra decidir. Passo separado
    // para não tocar na assinatura da RPC crítica de escrita.
    if (categoriaId && resultado?.transacao_id) {
      await supabase.rpc("definir_categoria_transacao", {
        p_transacao_id: resultado.transacao_id,
        p_categoria_id: categoriaId,
      });
    }
    setPendente(false);

    setOk(`Transação registrada: ${resultado?.parcelas_criadas ?? 1} parcela(s).`);
    setDescricao("");
    setValor("");
    setNumParcelas("1");
    setCategoriaId("");
    router.refresh();
  }

  return (
    <form onSubmit={enviar} className="vidro-soberano p-4">
      <h2 className="mb-3 font-medium">Nova transação</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm sm:col-span-2">
          Descrição
          <input
            value={descricao}
            onChange={(e) => setDescricao(e.target.value)}
            required
            className="campo-soberano"
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
            className="campo-soberano"
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
            className="campo-soberano"
          />
        </label>
        <label className="text-sm">
          Tipo
          <select
            value={tipo}
            onChange={(e) => setTipo(e.target.value)}
            className="campo-soberano"
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
            className="campo-soberano"
          >
            <option value="CREDITO">Crédito</option>
            <option value="DEBITO">Débito</option>
            <option value="PIX">Pix</option>
            <option value="DINHEIRO">Dinheiro</option>
          </select>
        </label>
        {categorias.length > 0 && (
          <label className="text-sm">
            Categoria
            <select
              value={categoriaId}
              onChange={(e) => setCategoriaId(e.target.value)}
              className="campo-soberano"
            >
              <option value="">Automática (por regra)</option>
              {categoriasDoTipo.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nome}
                </option>
              ))}
            </select>
          </label>
        )}
        {ehCredito && (
          <>
            <label className="text-sm">
              Cartão
              <select
                value={cartaoId}
                onChange={(e) => setCartaoId(e.target.value)}
                className="campo-soberano"
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
                max={MAX_PARCELAS_UI}
                value={numParcelas}
                onChange={(e) => setNumParcelas(e.target.value)}
                required
                className="campo-soberano"
              />
            </label>
          </>
        )}
      </div>
      {erro && <p className="mt-2 text-sm" style={{ color: "var(--acento-negativo)" }}>{erro}</p>}
      {ok && <p className="mt-2 text-sm" style={{ color: "var(--acento)" }}>{ok}</p>}
      <button
        type="submit"
        disabled={pendente}
        className="botao-soberano mt-3 text-sm"
      >
        {pendente ? "Processando..." : "Registrar"}
      </button>
    </form>
  );
}
