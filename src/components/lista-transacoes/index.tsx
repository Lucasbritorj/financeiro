"use client";

// Histórico de transações. Só compõe: o estado e as chamadas ao banco vivem em
// use-lista.ts, a linha em linha-transacao.tsx e a barra de lote em
// barra-selecao.tsx.

import type { FiltrosTransacoes } from "@/lib/filtros-transacoes";
import { FormEdicao } from "@/components/lista-transacoes/form-edicao";
import { BarraSelecao } from "@/components/lista-transacoes/barra-selecao";
import { LinhaTransacao } from "@/components/lista-transacoes/linha-transacao";
import { useLista } from "@/components/lista-transacoes/use-lista";
import type {
  TransacaoLista,
  CategoriaOpcao,
  CartaoOpcao,
} from "@/components/lista-transacoes/tipos";

// Reexportado: transacoes/page.tsx importa o tipo junto com o componente.
export type { TransacaoLista };

function EsqueletoCarregando() {
  return (
    <div className="mt-1 grid gap-2" aria-hidden>
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="vidro-soberano flex items-center gap-3 px-4 py-3">
          <div className="skeleton h-4" style={{ width: "40%" }} />
          <div className="skeleton ml-auto h-4" style={{ width: "5rem" }} />
        </div>
      ))}
    </div>
  );
}

export default function ListaTransacoes({
  inicial,
  categorias,
  cartoes,
  temMais: temMaisInicial,
  filtros = {},
}: {
  inicial: TransacaoLista[];
  categorias: CategoriaOpcao[];
  cartoes: CartaoOpcao[];
  temMais: boolean;
  /** Mesmos filtros da 1ª página (servidor) — o keyset continua com eles. */
  filtros?: FiltrosTransacoes;
}) {
  const lista = useLista({ inicial, temMais: temMaisInicial, filtros });

  if (lista.itens.length === 0) {
    return (
      <p className="text-sm" style={{ color: "var(--grafite)" }}>
        Nenhuma transação registrada ainda. Lance uma acima ou importe um extrato.
      </p>
    );
  }

  return (
    <div className="grid gap-2">
      <BarraSelecao
        total={lista.itens.length}
        selecionadas={lista.selecionadas.size}
        excluindoLote={lista.excluindoLote}
        onSelecionarTodas={lista.selecionarTodas}
        onExcluirSelecionadas={lista.excluirSelecionadas}
      />

      {lista.itens.map((t) =>
        lista.editando === t.id ? (
          <FormEdicao
            key={t.id}
            transacao={t}
            categorias={categorias}
            cartoes={cartoes}
            aoFechar={() => lista.setEditando(null)}
            aoSalvar={(atualizada) => lista.salvarEdicao(t.id, atualizada)}
          />
        ) : (
          <LinhaTransacao
            key={t.id}
            transacao={t}
            categorias={categorias}
            selecionada={lista.selecionadas.has(t.id)}
            onAlternarSelecao={lista.alternarSelecao}
            onRecategorizar={lista.recategorizar}
            onEditar={lista.setEditando}
            onExcluir={lista.removerLocal}
          />
        ),
      )}

      {lista.carregando && <EsqueletoCarregando />}

      {lista.temMais && !lista.carregando && (
        <button
          type="button"
          onClick={lista.carregarMais}
          className="botao-fantasma mt-2 justify-self-center text-sm"
        >
          Carregar mais
        </button>
      )}
    </div>
  );
}
