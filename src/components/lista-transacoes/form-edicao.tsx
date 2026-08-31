"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { paraCentavos, centavosParaDecimalEditavel } from "@/lib/money";
import { mensagemDeErro } from "@/lib/erros";
import {
  decidirEstrategiaEdicao,
  FORMA_CREDITO,
} from "@/lib/edicao-transacao";
import type {
  TransacaoLista,
  CategoriaOpcao,
  CartaoOpcao,
} from "@/components/lista-transacoes/tipos";

// Edição completa: além de descrição/valor/data, permite trocar tipo, forma
// de pagamento, cartão e parcelas. Qual RPC atende cada combinação é decidido
// por decidirEstrategiaEdicao (src/lib/edicao-transacao.ts) — lógica pura,
// testada isoladamente.
export function FormEdicao({
  transacao,
  categorias,
  cartoes,
  aoFechar,
  aoSalvar,
}: {
  transacao: TransacaoLista;
  categorias: CategoriaOpcao[];
  cartoes: CartaoOpcao[];
  aoFechar: () => void;
  aoSalvar: (t: TransacaoLista) => void;
}) {
  const [descricao, setDescricao] = useState(transacao.descricao);
  const [valor, setValor] = useState(centavosParaDecimalEditavel(transacao.valor_total));
  const [data, setData] = useState(transacao.data_compra);
  const [tipo, setTipo] = useState(transacao.tipo);
  const [forma, setForma] = useState(transacao.forma_pagamento);
  const [cartaoId, setCartaoId] = useState<string>(cartoes[0]?.id ?? "");
  const [numParcelas, setNumParcelas] = useState(String(transacao.num_parcelas || 1));
  const [categoriaId, setCategoriaId] = useState(transacao.categoria_id ?? "");
  const [vencimento, setVencimento] = useState(transacao.data_vencimento ?? "");
  const [pendente, setPendente] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const ehCredito = forma === FORMA_CREDITO;
  const categoriasDoTipo = categorias.filter((c) => c.tipo === tipo);

  const estrategia = decidirEstrategiaEdicao(transacao, {
    tipo,
    forma,
    numParcelas,
    categoriaId,
  });
  const ehBoleto = estrategia === "editar_boleto";
  // Só descrição/valor/data mudaram => edição barata (mantém parcelas).
  const soCamposLeves = estrategia === "editar_transacao";

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);
    const centavos = paraCentavos(valor);
    if (!Number.isFinite(centavos)) {
      setErro("Valor inválido.");
      return;
    }
    if (ehCredito && !cartaoId) {
      setErro("Selecione um cartão para o crédito.");
      return;
    }
    if (ehBoleto && !vencimento) {
      setErro("Informe a data de vencimento do boleto.");
      return;
    }
    setPendente(true);
    const supabase = createClient();

    // Boleto: edição focada (valor variável, vencimento) via RPC própria.
    if (estrategia === "editar_boleto") {
      const { error } = await supabase.rpc("editar_boleto", {
        p_transacao_id: transacao.id,
        p_descricao: descricao.trim(),
        p_valor: centavos,
        p_data_vencimento: vencimento,
        p_data_competencia: data,
        p_categoria_id: categoriaId || null,
        p_alterar_categoria: true,
      });
      setPendente(false);
      if (error) {
        setErro(mensagemDeErro(error));
        return;
      }
      aoSalvar({
        ...transacao,
        descricao: descricao.trim(),
        valor_total: centavos,
        data_compra: data,
        data_vencimento: vencimento,
        categoria_id: categoriaId || null,
      });
      return;
    }

    if (estrategia === "editar_transacao") {
      const { error } = await supabase.rpc("editar_transacao", {
        p_transacao_id: transacao.id,
        p_descricao: descricao.trim(),
        p_valor_total: centavos,
        p_data_compra: data,
      });
      setPendente(false);
      if (error) {
        setErro(mensagemDeErro(error));
        return;
      }
      aoSalvar({
        ...transacao,
        descricao: descricao.trim(),
        valor_total: centavos,
        data_compra: data,
      });
      return;
    }

    // Mudou tipo/forma/parcelas/categoria: substitui (recria) atomicamente.
    const { data: res, error } = await supabase.rpc("substituir_transacao", {
      p_transacao_id: transacao.id,
      p_descricao: descricao.trim(),
      p_valor_total: centavos,
      p_tipo: tipo,
      p_forma_pagamento: forma,
      p_cartao_id: ehCredito ? cartaoId : null,
      p_data_compra: data,
      p_num_parcelas: ehCredito ? Number(numParcelas) : 1,
      p_categoria_id: categoriaId || null,
    });
    setPendente(false);
    if (error) {
      setErro(mensagemDeErro(error));
      return;
    }
    const novoId = (res as { transacao_id?: string } | null)?.transacao_id ?? transacao.id;
    aoSalvar({
      ...transacao,
      id: novoId,
      descricao: descricao.trim(),
      valor_total: centavos,
      data_compra: data,
      tipo,
      forma_pagamento: forma,
      num_parcelas: ehCredito ? Number(numParcelas) : 1,
      categoria_id: categoriaId || null,
    });
  }

  // Boleto: form dedicado (sem tipo/forma/cartão/parcelas), com vencimento.
  if (ehBoleto) {
    return (
      <form onSubmit={salvar} className="vidro-soberano grid gap-3 p-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-sm sm:col-span-2">
            Descrição
            <input
              value={descricao}
              onChange={(e) => setDescricao(e.target.value)}
              required
              className="campo-soberano"
              aria-label="Descrição do boleto"
            />
          </label>
          <label className="text-sm">
            Valor (R$)
            <input
              value={valor}
              onChange={(e) => setValor(e.target.value)}
              inputMode="decimal"
              required
              className="campo-soberano"
              aria-label="Valor do boleto"
            />
          </label>
          <label className="text-sm">
            Vencimento
            <input
              type="date"
              value={vencimento}
              onChange={(e) => setVencimento(e.target.value)}
              required
              className="campo-soberano"
              aria-label="Vencimento"
            />
          </label>
          <label className="text-sm">
            Competência (mês de referência)
            <input
              type="date"
              value={data}
              onChange={(e) => setData(e.target.value)}
              className="campo-soberano"
              aria-label="Competência"
            />
          </label>
          {categorias.length > 0 && (
            <label className="text-sm">
              Categoria
              <select
                value={categoriaId}
                onChange={(e) => setCategoriaId(e.target.value)}
                className="campo-soberano"
              >
                <option value="">Automática / sem categoria</option>
                {categorias
                  .filter((c) => c.tipo === "DESPESA")
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.nome}
                    </option>
                  ))}
              </select>
            </label>
          )}
        </div>
        <p className="text-xs" style={{ color: "var(--grafite)" }}>
          Boleto pago não pode ser editado (histórico). Ajuste o valor antes de
          marcar como pago em Contas a pagar.
        </p>
        {erro && (
          <p className="text-sm" style={{ color: "var(--telha)" }}>
            {erro}
          </p>
        )}
        <div className="flex gap-3">
          <button type="submit" disabled={pendente} className="botao-soberano text-sm">
            {pendente ? "Salvando..." : "Salvar"}
          </button>
          <button type="button" onClick={aoFechar} className="botao-fantasma text-sm">
            Cancelar
          </button>
        </div>
      </form>
    );
  }

  return (
    <form onSubmit={salvar} className="vidro-soberano grid gap-3 p-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm sm:col-span-2">
          Descrição
          <input
            value={descricao}
            onChange={(e) => setDescricao(e.target.value)}
            required
            className="campo-soberano"
            aria-label="Descrição"
          />
        </label>
        <label className="text-sm">
          Valor (R$)
          <input
            value={valor}
            onChange={(e) => setValor(e.target.value)}
            inputMode="decimal"
            required
            className="campo-soberano"
            aria-label="Valor"
          />
        </label>
        <label className="text-sm">
          Data da compra
          <input
            type="date"
            value={data}
            onChange={(e) => setData(e.target.value)}
            className="campo-soberano"
            aria-label="Data da compra"
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
          Forma de pagamento
          <select value={forma} onChange={(e) => setForma(e.target.value)} className="campo-soberano">
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
                className="campo-soberano"
              >
                {cartoes.length === 0 && <option value="">Nenhum cartão</option>}
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
                className="campo-soberano"
              />
            </label>
          </>
        )}
        {categorias.length > 0 && (
          <label className="text-sm">
            Categoria
            <select
              value={categoriaId}
              onChange={(e) => setCategoriaId(e.target.value)}
              className="campo-soberano"
            >
              <option value="">Automática / sem categoria</option>
              {categoriasDoTipo.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nome}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      {!soCamposLeves && (
        <p className="text-xs" style={{ color: "var(--grafite)" }}>
          Mudar tipo, forma, cartão ou parcelas recria a transação (recalcula
          parcelas e faturas). Transação com parcela já paga não pode ser
          alterada.
        </p>
      )}
      {erro && (
        <p className="text-sm" style={{ color: "var(--telha)" }}>
          {erro}
        </p>
      )}
      <div className="flex gap-3">
        <button type="submit" disabled={pendente} className="botao-soberano text-sm">
          {pendente ? "Salvando..." : "Salvar"}
        </button>
        <button type="button" onClick={aoFechar} className="botao-fantasma text-sm">
          Cancelar
        </button>
      </div>
    </form>
  );
}
