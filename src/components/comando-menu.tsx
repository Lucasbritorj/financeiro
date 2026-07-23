"use client";

// Menu de comandos (Ctrl+K): lançamento por frase ("89,90 ifood ontem em 2x")
// e navegação, num <dialog> nativo — mesmo padrão acessível do feedback.tsx
// (foco preso, Esc, backdrop), zero dependência nova. O parsing é todo do
// parser puro em lib/comando.ts; aqui só orquestração: abrir, listar,
// executar RPC e avisar via toast. As opções são DADOS (sem closures),
// executadas por um único handler — exigência das regras do React Compiler.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { mensagemDeErro } from "@/lib/erros";
import { formatarCentavos, formatarData } from "@/lib/money";
import {
  parseComando,
  sugerirRotas,
  type CartaoRef,
  type ComandoTransacao,
} from "@/lib/comando";
import { useToast } from "@/components/feedback";

function hojeSaoPaulo(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
  }).format(new Date());
}

const FORMA_ROTULO: Record<ComandoTransacao["forma"], string> = {
  CREDITO: "Crédito",
  DEBITO: "Débito",
  PIX: "Pix",
  DINHEIRO: "Dinheiro",
};

const EXEMPLOS =
  '"45 ifood" · "recebi 4500 salário dia 5" · "500 notebook em 5x" · "ir para cofrinhos"';

type Opcao = {
  id: string;
  titulo: string;
  detalhe?: string;
  acao: { tipo: "registrar" } | { tipo: "rota"; rota: string };
};

export default function ComandoMenu() {
  const router = useRouter();
  const notificar = useToast();
  const dialogRef = useRef<HTMLDialogElement>(null);
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
  }, [cartoes, notificar]);

  function fechar() {
    dialogRef.current?.close();
  }

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
  }, [abrir]);

  const comando = useMemo(
    () => parseComando(query, { hoje, cartoes: cartoes ?? [] }),
    [query, hoje, cartoes],
  );

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
    notificar(
      `Registrado: ${t.descricao} — ${formatarCentavos(t.valorCentavos)}.`,
      "sucesso",
    );
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

  // Dados puros por render — barato (lista minúscula) e sem estado velho.
  let opcoes: Opcao[] = [];
  if (comando?.tipo === "transacao") {
    const quando = comando.dataCompra === hoje ? "hoje" : formatarData(comando.dataCompra);
    const meio =
      comando.forma === "CREDITO"
        ? `${comando.cartaoNome ?? "Crédito"}${comando.numParcelas > 1 ? ` em ${comando.numParcelas}x` : ""}`
        : FORMA_ROTULO[comando.forma];
    opcoes = [
      {
        id: "registrar",
        titulo: `Registrar ${comando.tipoTransacao === "RECEITA" ? "receita" : "despesa"} · ${formatarCentavos(comando.valorCentavos)} — ${comando.descricao}`,
        detalhe: `${quando} · ${meio} · categoria automática`,
        acao: { tipo: "registrar" },
      },
    ];
  } else if (comando?.tipo === "navegacao") {
    opcoes = [
      {
        id: comando.rota,
        titulo: `Ir para ${comando.rotulo}`,
        acao: { tipo: "rota", rota: comando.rota },
      },
    ];
  } else if (comando === null) {
    opcoes = sugerirRotas(query).map((r) => ({
      id: r.rota,
      titulo: `Ir para ${r.rotulo}`,
      acao: { tipo: "rota", rota: r.rota },
    }));
  }
  const indiceAtivo = Math.min(ativo, Math.max(opcoes.length - 1, 0));

  function aoTeclar(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setAtivo(Math.min(indiceAtivo + 1, Math.max(opcoes.length - 1, 0)));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setAtivo(Math.max(indiceAtivo - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const op = opcoes[indiceAtivo];
      if (op) executarOpcao(op);
    }
  }

  return (
    <>
      <button
        type="button"
        className="botao-fantasma comando-gatilho text-sm"
        onClick={abrir}
        aria-label="Abrir menu de comandos"
        title="Lançar transação ou navegar por texto (Ctrl+K)"
      >
        <span className="hidden sm:inline">Comando</span>
        <kbd className="comando-kbd">Ctrl K</kbd>
      </button>

      <dialog
        ref={dialogRef}
        className="dialogo comando-dialogo"
        aria-label="Menu de comandos"
        onClose={() => {
          setQuery("");
          setAtivo(0);
        }}
        onClick={(e) => {
          if (e.target === dialogRef.current) fechar(); // clique no backdrop
        }}
      >
        <div
          role="combobox"
          aria-expanded="true"
          aria-haspopup="listbox"
          aria-controls="comando-opcoes"
        >
          <input
            ref={inputRef}
            className="comando-campo"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setAtivo(0);
            }}
            onKeyDown={aoTeclar}
            placeholder="Lance por frase ou navegue… (ex.: 45 ifood ontem)"
            aria-activedescendant={opcoes[indiceAtivo] ? `comando-op-${indiceAtivo}` : undefined}
            aria-autocomplete="list"
            autoComplete="off"
            spellCheck={false}
          />
          <ul id="comando-opcoes" role="listbox" className="comando-lista">
            {opcoes.map((op, i) => (
              <li
                key={op.id}
                id={`comando-op-${i}`}
                role="option"
                aria-selected={i === indiceAtivo}
                data-ativo={i === indiceAtivo}
                className="comando-item"
                onMouseEnter={() => setAtivo(i)}
                onClick={() => executarOpcao(op)}
              >
                <span className="comando-item-titulo">
                  {pendente && op.id === "registrar" ? "Processando..." : op.titulo}
                </span>
                {op.detalhe && <span className="comando-item-detalhe">{op.detalhe}</span>}
              </li>
            ))}
            {comando?.tipo === "invalido" && (
              <li className="comando-dica" role="note">
                {comando.motivo}
              </li>
            )}
            {opcoes.length === 0 && comando?.tipo !== "invalido" && (
              <li className="comando-dica" role="note">
                Sem correspondência. Inclua um valor para lançar: {EXEMPLOS}
              </li>
            )}
          </ul>
          <p className="comando-rodape">
            ↑↓ navega · Enter executa · Esc fecha
            {query === "" && <span className="hidden sm:inline"> · {EXEMPLOS}</span>}
          </p>
        </div>
      </dialog>
    </>
  );
}
