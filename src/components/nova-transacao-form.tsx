"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { paraCentavos } from "@/lib/money";
import { mensagemDeErro } from "@/lib/erros";
import { MAX_PARCELAS_UI } from "@/lib/constantes";
import { mensagemPosTransacao } from "@/lib/nova-transacao";
import { useToast } from "@/components/feedback";

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
  const notificar = useToast();
  const [descricao, setDescricao] = useState("");
  const [valor, setValor] = useState("");
  const [tipo, setTipo] = useState("DESPESA");
  const [forma, setForma] = useState("CREDITO");
  const [cartaoId, setCartaoId] = useState(cartoes[0]?.id ?? "");
  const [categoriaId, setCategoriaId] = useState("");
  const [dataCompra, setDataCompra] = useState(hojeSaoPaulo);
  const [vencimento, setVencimento] = useState("");
  const [numParcelas, setNumParcelas] = useState("1");
  const [pendente, setPendente] = useState(false);

  const ehCredito = forma === "CREDITO";
  const ehBoleto = forma === "BOLETO";
  // Boleto é sempre DESPESA (conta a pagar). Categoria vazia => trigger de
  // autocategorização (0008) decide pela regra.
  const tipoEfetivo = ehBoleto ? "DESPESA" : tipo;
  const categoriasDoTipo = categorias.filter((c) => c.tipo === tipoEfetivo);

  // Trocar para boleto força despesa; trocar de volta preserva a escolha.
  function trocarForma(nova: string) {
    setForma(nova);
    if (nova === "BOLETO") setTipo("DESPESA");
  }

  async function enviar(e: React.FormEvent) {
    e.preventDefault();

    const centavos = paraCentavos(valor);
    if (!Number.isFinite(centavos)) {
      notificar("Valor inválido.", "erro");
      return;
    }
    if (ehCredito && !cartaoId) {
      notificar("Cadastre e selecione um cartão para lançar no crédito.", "erro");
      return;
    }
    if (ehBoleto && !vencimento) {
      notificar("Informe a data de vencimento do boleto.", "erro");
      return;
    }

    setPendente(true);
    const supabase = createClient();

    // ===== Boleto: conta a pagar com vencimento (RPC dedicada) =====
    if (ehBoleto) {
      const { data, error } = await supabase.rpc("criar_boleto", {
        p_descricao: descricao.trim(),
        p_valor: centavos,
        p_data_vencimento: vencimento,
        // Competência = mês de referência do gasto; default no servidor = mês
        // do vencimento. Aqui usamos a data escolhida (campo "competência").
        p_data_competencia: dataCompra || null,
        p_categoria_id: categoriaId || null,
      });
      setPendente(false);
      if (error) {
        notificar(mensagemDeErro(error), "erro");
        return;
      }
      void data;
      notificar("Boleto registrado em Contas a pagar.", "sucesso");
      setDescricao("");
      setValor("");
      setVencimento("");
      setCategoriaId("");
      router.refresh();
      return;
    }

    // ===== Transação comum: motor RPC atômico =====
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
      notificar(mensagemDeErro(error), "erro");
      return;
    }
    const resultado = data as { transacao_id?: string; parcelas_criadas?: number } | null;

    // Categoria escolhida à mão prevalece sobre a autocategorização por
    // regra (trigger 0008); vazio = deixa a regra decidir. Passo separado
    // para não tocar na assinatura da RPC crítica de escrita.
    let erroCategoria: { message: string; hint?: string | null } | null = null;
    if (categoriaId && resultado?.transacao_id) {
      const resp = await supabase.rpc("definir_categoria_transacao", {
        p_transacao_id: resultado.transacao_id,
        p_categoria_id: categoriaId,
      });
      erroCategoria = resp.error;
    }
    setPendente(false);

    const pos = mensagemPosTransacao(resultado?.parcelas_criadas, erroCategoria);
    notificar(pos.texto, pos.tipo);
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
            placeholder={ehBoleto ? "Ex.: Conta de luz" : "Ex.: Mercado"}
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
          {ehBoleto ? "Competência (mês de referência)" : "Data da compra"}
          <input
            type="date"
            value={dataCompra}
            onChange={(e) => setDataCompra(e.target.value)}
            required
            className="campo-soberano"
          />
        </label>
        <label className="text-sm">
          Forma de pagamento
          <select
            value={forma}
            onChange={(e) => trocarForma(e.target.value)}
            className="campo-soberano"
          >
            <option value="CREDITO">Crédito</option>
            <option value="DEBITO">Débito</option>
            <option value="PIX">Pix</option>
            <option value="DINHEIRO">Dinheiro</option>
            <option value="BOLETO">Boleto / conta a pagar</option>
          </select>
        </label>
        {ehBoleto ? (
          <label className="text-sm">
            Vencimento
            <input
              type="date"
              value={vencimento}
              onChange={(e) => setVencimento(e.target.value)}
              required
              className="campo-soberano"
            />
          </label>
        ) : (
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
        )}
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
      {ehBoleto && (
        <p className="mt-2 text-xs" style={{ color: "var(--grafite)" }}>
          Boleto é uma conta a pagar (luz, água, gás…): entra como despesa da
          competência agora e só sai da carteira quando você marcar como paga,
          em <strong>Contas a pagar</strong>. A <strong>competência</strong> é o
          mês de referência do gasto (a luz de julho é julho, mesmo que vença em
          agosto) — ajuste se o vencimento for de outro mês.
        </p>
      )}
      <button
        type="submit"
        disabled={pendente}
        className="botao-soberano mt-3 text-sm"
      >
        {pendente ? "Processando..." : ehBoleto ? "Registrar boleto" : "Registrar"}
      </button>
    </form>
  );
}
