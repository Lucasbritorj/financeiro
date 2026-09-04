"use client";

// Estado e efeitos do menu de comandos: atalho global, carga preguiçosa dos
// cartões, execução da opção escolhida. O parsing é todo do parser puro em
// lib/comando.ts, e a montagem da lista de lib/comando-opcoes.ts — aqui só
// orquestração.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { mensagemDeErro } from "@/lib/erros";
import { formatarCentavos } from "@/lib/money";
import { parseComando, type CartaoRef, type ComandoTransacao } from "@/lib/comando";
import { montarOpcoes, indiceValido, type Opcao } from "@/lib/comando-opcoes";
import { useToast } from "@/components/feedback";
import { hojeSaoPaulo } from "@/lib/data";

export function useComando(dialogRef: React.RefObject<HTMLDialogElement | null>) {
  const router = useRouter();
  const notificar = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [ativo, setAtivo] = useState(0);
  const [pendente, setPendente] = useState(false);
  const [cartoes, setCartoes] = useState<CartaoRef[] | null>(null);
  const hoje = useMemo(() => hojeSaoPaulo(), []);

  const abrir = useCallback(() => {
    const d = dialogRef.current;
    if (!d || d.open) return;
    d.showModal();
    inputRef.current?.focus();
    // Cartões só na primeira abertura — o parser precisa deles para "no nubank".
    if (cartoes === null) {
      createClient()
        .from("cartoes_credito")
        .select("id, nome")
        .order("nome")
        .then(({ data, error }) => {
          if (error) {
            notificar(`Não carreguei os cartões: ${mensagemDeErro(error)}`, "erro");
            setCartoes([]);
            return;
          }
          setCartoes(data ?? []);
        });
    }
  }, [cartoes, notificar, dialogRef]);

  const fechar = useCallback(() => dialogRef.current?.close(), [dialogRef]);

  useEffect(() => {
    const atalho = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        if (dialogRef.current?.open) dialogRef.current.close();
        else abrir();
      }
    };
    document.addEventListener("keydown", atalho);
    return () => document.removeEventListener("keydown", atalho);
  }, [abrir, dialogRef]);

  const comando = useMemo(
    () => parseComando(query, { hoje, cartoes: cartoes ?? [] }),
    [query, hoje, cartoes],
  );

  // Dados puros por render — barato (lista minúscula) e sem estado velho.
  const opcoes = montarOpcoes(comando, query, hoje);
  const indiceAtivo = indiceValido(ativo, opcoes.length);

  // Guarda por ref: dois Enter no mesmo tick não podem virar duas RPCs.
  const pendenteRef = useRef(false);
  async function registrar(t: ComandoTransacao) {
    if (pendenteRef.current) return;
    pendenteRef.current = true;
    setPendente(true);
    const { error } = await createClient().rpc("processar_transacao_completa", {
      p_descricao: t.descricao,
      p_valor_total: t.valorCentavos,
      p_tipo: t.tipoTransacao,
      p_forma_pagamento: t.forma,
      p_cartao_id: t.forma === "CREDITO" ? t.cartaoId : null,
      p_data_compra: t.dataCompra,
      p_num_parcelas: t.forma === "CREDITO" ? t.numParcelas : 1,
    });
    pendenteRef.current = false;
    setPendente(false);
    if (error) {
      notificar(mensagemDeErro(error), "erro");
      return; // menu fica aberto para corrigir a frase
    }
    notificar(`Registrado: ${t.descricao} — ${formatarCentavos(t.valorCentavos)}.`, "sucesso");
    fechar();
    router.refresh();
  }

  function executarOpcao(op: Opcao) {
    if (op.acao.tipo === "rota") {
      fechar();
      router.push(op.acao.rota);
      return;
    }
    if (comando?.tipo === "transacao") void registrar(comando);
  }

  function aoTeclar(e: React.KeyboardEvent<HTMLInputElement>) {
    const ultimo = Math.max(opcoes.length - 1, 0);
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setAtivo(Math.min(indiceAtivo + 1, ultimo));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setAtivo(Math.max(indiceAtivo - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const op = opcoes[indiceAtivo];
      if (op) executarOpcao(op);
    }
  }

  function digitar(texto: string) {
    setQuery(texto);
    setAtivo(0);
  }

  function limpar() {
    setQuery("");
    setAtivo(0);
  }

  return {
    inputRef,
    query,
    digitar,
    limpar,
    comando,
    opcoes,
    indiceAtivo,
    setAtivo,
    pendente,
    abrir,
    fechar,
    aoTeclar,
    executarOpcao,
  };
}
