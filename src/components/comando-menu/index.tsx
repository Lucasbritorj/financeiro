"use client";

// Menu de comandos (Ctrl+K): lançamento por frase ("89,90 ifood ontem em 2x")
// e navegação, num <dialog> nativo — mesmo padrão acessível do feedback.tsx
// (foco preso, Esc, backdrop), zero dependência nova. O parsing é do parser
// puro em lib/comando.ts, a lista de lib/comando-opcoes.ts, e o estado de
// use-comando.ts. Aqui só a marcação.

import { useRef } from "react";
import { EXEMPLOS } from "@/lib/comando-opcoes";
import { useComando } from "./use-comando";

export default function ComandoMenu() {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const {
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
  } = useComando(dialogRef);

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
        onClose={limpar}
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
            onChange={(e) => digitar(e.target.value)}
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
