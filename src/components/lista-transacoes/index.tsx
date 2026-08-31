"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { formatarCentavos, formatarCentavosAcessivel, formatarData } from "@/lib/money";
import { mensagemDeErro } from "@/lib/erros";
import { TAMANHO_PAGINA_TRANSACOES } from "@/lib/constantes";
import {
  aplicarFiltrosTransacoes,
  type FiltrosTransacoes,
} from "@/lib/filtros-transacoes";
import { useToast, useConfirm } from "@/components/feedback";
import { FormEdicao } from "@/components/lista-transacoes/form-edicao";
import { BotaoExcluir } from "@/components/lista-transacoes/botao-excluir";
import {
  COLUNAS,
  type TransacaoLista,
  type CategoriaOpcao,
  type CartaoOpcao,
} from "@/components/lista-transacoes/tipos";

// Reexportado: transacoes/page.tsx importa o tipo junto com o componente.
export type { TransacaoLista };

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
  const router = useRouter();
  const notificar = useToast();
  const confirmar = useConfirm();
  const [itens, setItens] = useState<TransacaoLista[]>(inicial);
  const [temMais, setTemMais] = useState(temMaisInicial);
  const [carregando, setCarregando] = useState(false);
  const [editando, setEditando] = useState<string | null>(null);
  const [selecionadas, setSelecionadas] = useState<Set<string>>(new Set());
  const [excluindoLote, setExcluindoLote] = useState(false);

  function alternarSelecao(id: string) {
    setSelecionadas((atual) => {
      const proximo = new Set(atual);
      if (proximo.has(id)) proximo.delete(id);
      else proximo.add(id);
      return proximo;
    });
  }
  function selecionarTodas(marcar: boolean) {
    setSelecionadas(marcar ? new Set(itens.map((t) => t.id)) : new Set());
  }

  // Keyset por (created_at, id) desc: estável mesmo com inserções durante
  // a paginação (o .limit(N) fixo pulava/duplicava linhas).
  async function carregarMais() {
    const cursor = itens[itens.length - 1];
    if (!cursor) return;
    setCarregando(true);
    const consulta = createClient()
      .from("transacoes_origem")
      .select(COLUNAS)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      // Timestamp entre aspas: contém '.'/':'/'+' reservados no grammar do
      // PostgREST; sem aspas o filtro é mal interpretado.
      .or(
        `created_at.lt."${cursor.created_at}",and(created_at.eq."${cursor.created_at}",id.lt.${cursor.id})`
      )
      .limit(TAMANHO_PAGINA_TRANSACOES);
    const { data, error } = await aplicarFiltrosTransacoes(consulta, filtros);
    setCarregando(false);
    if (error) {
      notificar(error.message, "erro");
      return;
    }
    const pagina = (data as TransacaoLista[]) ?? [];
    setItens((atual) => [...atual, ...pagina]);
    setTemMais(pagina.length === TAMANHO_PAGINA_TRANSACOES);
  }

  async function recategorizar(t: TransacaoLista, categoriaId: string, criarRegra: boolean) {
    const supabase = createClient();
    const { error } = await supabase.rpc("definir_categoria_transacao", {
      p_transacao_id: t.id,
      p_categoria_id: categoriaId || null,
      p_criar_regra: criarRegra,
      p_padrao: criarRegra ? t.descricao.trim().slice(0, 40) : null,
    });
    if (error) {
      notificar(mensagemDeErro(error), "erro");
      return;
    }
    if (criarRegra) notificar("Regra criada: descrições parecidas serão classificadas assim.", "sucesso");
    setItens((atual) =>
      atual.map((x) => (x.id === t.id ? { ...x, categoria_id: categoriaId || null } : x))
    );
    if (criarRegra) router.refresh();
  }

  // Exclusão em massa: cada excluir_transacao é atômico no banco; aqui as
  // selecionadas caem em paralelo (allSettled p/ não abortar no 1º FW409 —
  // ex.: transação com parcela PAGA). Só some da lista o que excluiu.
  async function excluirSelecionadas() {
    const ids = [...selecionadas];
    if (ids.length === 0) return;
    const ok = await confirmar({
      titulo: "Excluir selecionadas",
      mensagem: `Excluir ${ids.length} transação(ões)? Parcelas pendentes saem das faturas.`,
      rotuloConfirmar: "Excluir",
      perigo: true,
    });
    if (!ok) return;
    setExcluindoLote(true);
    const supabase = createClient();
    const resultados = await Promise.allSettled(
      ids.map((id) =>
        supabase.rpc("excluir_transacao", { p_transacao_id: id }).then((r) => {
          if (r.error) throw new Error(mensagemDeErro(r.error));
          return id;
        })
      )
    );
    setExcluindoLote(false);
    const excluidas = new Set(
      resultados.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []))
    );
    const falhas = resultados.filter((r) => r.status === "rejected").length;
    setItens((atual) => atual.filter((t) => !excluidas.has(t.id)));
    setSelecionadas(new Set());
    if (falhas > 0) {
      notificar(
        `${excluidas.size} excluída(s); ${falhas} não puderam ser excluídas (ex.: parcela paga).`,
        "erro"
      );
    } else {
      notificar(`${excluidas.size} transação(ões) excluída(s).`, "sucesso");
    }
    router.refresh();
  }

  if (itens.length === 0) {
    return (
      <p className="text-sm" style={{ color: "var(--grafite)" }}>
        Nenhuma transação registrada ainda. Lance uma acima ou importe um extrato.
      </p>
    );
  }

  const todasMarcadas = itens.length > 0 && selecionadas.size === itens.length;

  return (
    <div className="grid gap-2">
      <div
        className="flex flex-wrap items-center gap-x-4 gap-y-2 px-1 text-sm"
        style={{ color: "var(--grafite)" }}
      >
        <label className="inline-flex cursor-pointer items-center gap-2">
          <input
            type="checkbox"
            checked={todasMarcadas}
            onChange={(e) => selecionarTodas(e.target.checked)}
            aria-label="Selecionar todas as transações carregadas"
          />
          Selecionar todas ({itens.length})
        </label>
        {selecionadas.size > 0 && (
          <>
            <span style={{ color: "var(--giz)" }}>{selecionadas.size} selecionada(s)</span>
            <button
              type="button"
              onClick={excluirSelecionadas}
              disabled={excluindoLote}
              className="botao-fantasma botao-perigo text-xs"
            >
              {excluindoLote ? "Excluindo..." : "Excluir selecionadas"}
            </button>
            <button
              type="button"
              onClick={() => selecionarTodas(false)}
              className="text-xs underline-offset-2 hover:underline"
            >
              limpar
            </button>
          </>
        )}
      </div>

      {itens.map((t) =>
        editando === t.id ? (
          <FormEdicao
            key={t.id}
            transacao={t}
            categorias={categorias}
            cartoes={cartoes}
            aoFechar={() => setEditando(null)}
            aoSalvar={(atualizada) => {
              setItens((atual) => atual.map((x) => (x.id === t.id ? atualizada : x)));
              setEditando(null);
              router.refresh();
            }}
          />
        ) : (
          <div
            key={t.id}
            className="vidro-soberano flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3"
            style={selecionadas.has(t.id) ? { borderColor: "var(--ouro)" } : undefined}
          >
            <input
              type="checkbox"
              checked={selecionadas.has(t.id)}
              onChange={() => alternarSelecao(t.id)}
              aria-label={`Selecionar ${t.descricao}`}
            />
            <span className="font-medium">
              {t.descricao}
              {t.natureza === "LIQUIDACAO_FATURA" && (
                <span
                  className="ml-2 rounded px-1.5 py-0.5 align-middle text-[10px] font-normal uppercase tracking-wide"
                  style={{ color: "var(--ouro)", border: "1px solid var(--ouro)" }}
                  title="Pagamento de fatura de cartão. Não soma nas despesas — as compras já foram contadas quando aconteceram."
                >
                  Liquidação de fatura
                </span>
              )}
              {t.source && t.source !== "MANUAL" && (
                <span
                  className="ml-2 rounded px-1.5 py-0.5 align-middle text-[10px] font-normal uppercase tracking-wide"
                  style={{ color: "var(--grafite)", border: "1px solid var(--grafite)" }}
                  title={`Importado de ${t.source}`}
                >
                  {t.source}
                </span>
              )}
            </span>
            <span className="text-xs" style={{ color: "var(--grafite)" }}>
              {t.forma_pagamento === "BOLETO"
                ? `Boleto${t.data_vencimento ? ` · vence ${formatarData(t.data_vencimento)}` : ""}`
                : `${formatarData(t.data_compra)} · ${t.forma_pagamento}${
                    t.num_parcelas > 1 ? ` · ${t.num_parcelas}x` : ""
                  }`}
            </span>

            <select
              value={t.categoria_id ?? ""}
              onChange={(e) => recategorizar(t, e.target.value, false)}
              className="campo-soberano !mt-0 !w-auto py-1 text-xs"
              style={{ maxWidth: "10rem" }}
              aria-label={`Categoria de ${t.descricao}`}
            >
              <option value="">Sem categoria</option>
              {categorias
                .filter((c) => c.tipo === t.tipo)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nome}
                  </option>
                ))}
            </select>
            {t.categoria_id && (
              <button
                type="button"
                className="botao-fantasma text-xs"
                title="Sempre classificar descrições parecidas nesta categoria"
                onClick={() => recategorizar(t, t.categoria_id!, true)}
              >
                criar regra
              </button>
            )}

            <span
              className="numero-soberano ml-auto font-medium"
              style={{ color: t.tipo === "RECEITA" ? "var(--verde)" : "var(--giz)" }}
              aria-label={`${t.tipo === "RECEITA" ? "entrada de" : "saída de"} ${formatarCentavosAcessivel(t.valor_total)}`}
            >
              {t.tipo === "RECEITA" ? "+" : "-"}
              {formatarCentavos(t.valor_total)}
            </span>
            <button
              type="button"
              className="botao-fantasma text-xs"
              onClick={() => setEditando(t.id)}
            >
              Editar
            </button>
            <BotaoExcluir id={t.id} descricao={t.descricao} aoExcluir={(id) =>
              setItens((atual) => atual.filter((x) => x.id !== id))
            } />
          </div>
        )
      )}

      {carregando && (
        <div className="mt-1 grid gap-2" aria-hidden>
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="vidro-soberano flex items-center gap-3 px-4 py-3">
              <div className="skeleton h-4" style={{ width: "40%" }} />
              <div className="skeleton ml-auto h-4" style={{ width: "5rem" }} />
            </div>
          ))}
        </div>
      )}

      {temMais && !carregando && (
        <button
          type="button"
          onClick={carregarMais}
          className="botao-fantasma mt-2 justify-self-center text-sm"
        >
          Carregar mais
        </button>
      )}
    </div>
  );
}
