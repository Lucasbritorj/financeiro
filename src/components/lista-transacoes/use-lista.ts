"use client";

// Estado da lista de transações: paginação por keyset, recategorização e
// exclusão em lote. Tudo que fala com o banco vive aqui; os componentes só
// renderizam.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { mensagemDeErro } from "@/lib/erros";
import { TAMANHO_PAGINA_TRANSACOES } from "@/lib/constantes";
import { aplicarFiltrosTransacoes, type FiltrosTransacoes } from "@/lib/filtros-transacoes";
import { useToast, useConfirm } from "@/components/feedback";
import { COLUNAS, type TransacaoLista } from "@/components/lista-transacoes/tipos";

/** A mensagem do lote depende de ter havido recusa do banco ou não. */
function resumoDoLote(excluidas: number, falhas: number): [string, "erro" | "sucesso"] {
  if (falhas > 0) {
    return [
      `${excluidas} excluída(s); ${falhas} não puderam ser excluídas (ex.: parcela paga).`,
      "erro",
    ];
  }
  return [`${excluidas} transação(ões) excluída(s).`, "sucesso"];
}

export function useLista(args: {
  inicial: TransacaoLista[];
  temMais: boolean;
  filtros: FiltrosTransacoes;
}) {
  const router = useRouter();
  const notificar = useToast();
  const confirmar = useConfirm();
  const [itens, setItens] = useState<TransacaoLista[]>(args.inicial);
  const [temMais, setTemMais] = useState(args.temMais);
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
        `created_at.lt."${cursor.created_at}",and(created_at.eq."${cursor.created_at}",id.lt.${cursor.id})`,
      )
      .limit(TAMANHO_PAGINA_TRANSACOES);
    const { data, error } = await aplicarFiltrosTransacoes(consulta, args.filtros);
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
    const { error } = await createClient().rpc("definir_categoria_transacao", {
      p_transacao_id: t.id,
      p_categoria_id: categoriaId || null,
      p_criar_regra: criarRegra,
      p_padrao: criarRegra ? t.descricao.trim().slice(0, 40) : null,
    });
    if (error) {
      notificar(mensagemDeErro(error), "erro");
      return;
    }
    if (criarRegra) {
      notificar("Regra criada: descrições parecidas serão classificadas assim.", "sucesso");
    }
    setItens((atual) =>
      atual.map((x) => (x.id === t.id ? { ...x, categoria_id: categoriaId || null } : x)),
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
        }),
      ),
    );
    setExcluindoLote(false);

    const excluidas = new Set(
      resultados.flatMap((r) => (r.status === "fulfilled" ? [r.value] : [])),
    );
    const falhas = resultados.length - excluidas.size;
    setItens((atual) => atual.filter((t) => !excluidas.has(t.id)));
    setSelecionadas(new Set());
    notificar(...resumoDoLote(excluidas.size, falhas));
    router.refresh();
  }

  function removerLocal(id: string) {
    setItens((atual) => atual.filter((x) => x.id !== id));
  }

  function salvarEdicao(id: string, atualizada: TransacaoLista) {
    setItens((atual) => atual.map((x) => (x.id === id ? atualizada : x)));
    setEditando(null);
    router.refresh();
  }

  return {
    itens,
    temMais,
    carregando,
    editando,
    setEditando,
    selecionadas,
    excluindoLote,
    alternarSelecao,
    selecionarTodas,
    carregarMais,
    recategorizar,
    excluirSelecionadas,
    removerLocal,
    salvarEdicao,
  };
}
