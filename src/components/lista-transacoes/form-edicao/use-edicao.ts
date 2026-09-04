"use client";

// Estado e persistência da edição de transação. Qual RPC atende cada
// combinação é decidido por decidirEstrategiaEdicao (src/lib/edicao-transacao.ts)
// — lógica pura, testada isoladamente. Aqui fica o que fazer com a decisão:
// montar o payload de cada RPC e devolver ao pai a transação já atualizada.
//
// Escolher a RPC errada deixa as parcelas dessincronizadas do cabeçalho, então
// os três caminhos são funções separadas e explícitas em vez de um `salvar`
// com ramos aninhados.

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { paraCentavos, centavosParaDecimalEditavel } from "@/lib/money";
import { mensagemDeErro } from "@/lib/erros";
import {
  decidirEstrategiaEdicao,
  FORMA_CREDITO,
  type EstrategiaEdicao,
} from "@/lib/edicao-transacao";
import type { TransacaoLista, CartaoOpcao } from "@/components/lista-transacoes/tipos";

export type Campos = {
  descricao: string;
  valor: string;
  data: string;
  tipo: string;
  forma: string;
  cartaoId: string;
  numParcelas: string;
  categoriaId: string;
  vencimento: string;
};

function camposIniciais(transacao: TransacaoLista, cartoes: CartaoOpcao[]): Campos {
  return {
    descricao: transacao.descricao,
    valor: centavosParaDecimalEditavel(transacao.valor_total),
    data: transacao.data_compra,
    tipo: transacao.tipo,
    forma: transacao.forma_pagamento,
    cartaoId: cartoes[0]?.id ?? "",
    numParcelas: String(transacao.num_parcelas || 1),
    categoriaId: transacao.categoria_id ?? "",
    vencimento: transacao.data_vencimento ?? "",
  };
}

/** O que os executores precisam saber, já validado. */
type Contexto = {
  transacao: TransacaoLista;
  campos: Campos;
  centavos: number;
  ehCredito: boolean;
};

/** O erro tem a forma que mensagemDeErro consome — message e hint opcional. */
type ErroRpc = { message: string; hint?: string | null };
type Efeito = { error: ErroRpc | null; atualizado?: TransacaoLista };

/** Boleto: edição focada (valor variável, vencimento) via RPC própria. */
async function executarBoleto({ transacao, campos, centavos }: Contexto): Promise<Efeito> {
  const descricao = campos.descricao.trim();
  const { error } = await createClient().rpc("editar_boleto", {
    p_transacao_id: transacao.id,
    p_descricao: descricao,
    p_valor: centavos,
    p_data_vencimento: campos.vencimento,
    p_data_competencia: campos.data,
    p_categoria_id: campos.categoriaId || null,
    p_alterar_categoria: true,
  });
  if (error) return { error };
  return {
    error: null,
    atualizado: {
      ...transacao,
      descricao,
      valor_total: centavos,
      data_compra: campos.data,
      data_vencimento: campos.vencimento,
      categoria_id: campos.categoriaId || null,
    },
  };
}

/** Só descrição/valor/data mudaram: edição barata, que MANTÉM as parcelas. */
async function executarEdicaoLeve({ transacao, campos, centavos }: Contexto): Promise<Efeito> {
  const descricao = campos.descricao.trim();
  const { error } = await createClient().rpc("editar_transacao", {
    p_transacao_id: transacao.id,
    p_descricao: descricao,
    p_valor_total: centavos,
    p_data_compra: campos.data,
  });
  if (error) return { error };
  return {
    error: null,
    atualizado: { ...transacao, descricao, valor_total: centavos, data_compra: campos.data },
  };
}

/** Mudou tipo/forma/parcelas/categoria: substitui (recria) atomicamente. */
async function executarSubstituicao({
  transacao,
  campos,
  centavos,
  ehCredito,
}: Contexto): Promise<Efeito> {
  const descricao = campos.descricao.trim();
  const parcelas = ehCredito ? Number(campos.numParcelas) : 1;
  const { data: res, error } = await createClient().rpc("substituir_transacao", {
    p_transacao_id: transacao.id,
    p_descricao: descricao,
    p_valor_total: centavos,
    p_tipo: campos.tipo,
    p_forma_pagamento: campos.forma,
    p_cartao_id: ehCredito ? campos.cartaoId : null,
    p_data_compra: campos.data,
    p_num_parcelas: parcelas,
    p_categoria_id: campos.categoriaId || null,
  });
  if (error) return { error };
  return {
    error: null,
    atualizado: {
      ...transacao,
      // Sem transacao_id no retorno, preserva o id antigo: devolver undefined
      // para a lista do pai quebraria a `key` e o alvo das ações da linha.
      id: (res as { transacao_id?: string } | null)?.transacao_id ?? transacao.id,
      descricao,
      valor_total: centavos,
      data_compra: campos.data,
      tipo: campos.tipo,
      forma_pagamento: campos.forma,
      num_parcelas: parcelas,
      categoria_id: campos.categoriaId || null,
    },
  };
}

const EXECUTORES: Record<EstrategiaEdicao, (ctx: Contexto) => Promise<Efeito>> = {
  editar_boleto: executarBoleto,
  editar_transacao: executarEdicaoLeve,
  substituir_transacao: executarSubstituicao,
};

export function useEdicao(args: {
  transacao: TransacaoLista;
  cartoes: CartaoOpcao[];
  aoSalvar: (t: TransacaoLista) => void;
}) {
  const { transacao, cartoes, aoSalvar } = args;
  const [campos, setCampos] = useState<Campos>(() => camposIniciais(transacao, cartoes));
  const [pendente, setPendente] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  function definir<K extends keyof Campos>(campo: K, valor: Campos[K]) {
    setCampos((c) => ({ ...c, [campo]: valor }));
  }

  const ehCredito = campos.forma === FORMA_CREDITO;
  const estrategia = decidirEstrategiaEdicao(transacao, {
    tipo: campos.tipo,
    forma: campos.forma,
    numParcelas: campos.numParcelas,
    categoriaId: campos.categoriaId,
  });

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);
    const centavos = paraCentavos(campos.valor);
    if (!Number.isFinite(centavos)) return setErro("Valor inválido.");
    if (ehCredito && !campos.cartaoId) {
      return setErro("Selecione um cartão para o crédito.");
    }
    if (estrategia === "editar_boleto" && !campos.vencimento) {
      return setErro("Informe a data de vencimento do boleto.");
    }

    setPendente(true);
    const { error, atualizado } = await EXECUTORES[estrategia]({
      transacao,
      campos,
      centavos,
      ehCredito,
    });
    setPendente(false);
    if (error) return setErro(mensagemDeErro(error));
    if (atualizado) aoSalvar(atualizado);
  }

  return {
    campos,
    definir,
    ehCredito,
    ehBoleto: estrategia === "editar_boleto",
    /** Edição barata: nada que afete o parcelamento mudou. */
    soCamposLeves: estrategia === "editar_transacao",
    pendente,
    erro,
    salvar,
  };
}
