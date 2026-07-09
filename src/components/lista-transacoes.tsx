"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { formatarCentavos, formatarData, paraCentavos } from "@/lib/money";
import { mensagemDeErro } from "@/lib/erros";
import { TAMANHO_PAGINA_TRANSACOES } from "@/lib/constantes";

export type TransacaoLista = {
  id: string;
  descricao: string;
  valor_total: number;
  tipo: string;
  forma_pagamento: string;
  data_compra: string;
  num_parcelas: number;
  created_at: string;
  categoria_id: string | null;
};

type CategoriaOpcao = { id: string; nome: string; tipo: string };

const COLUNAS =
  "id, descricao, valor_total, tipo, forma_pagamento, data_compra, num_parcelas, created_at, categoria_id";

export default function ListaTransacoes({
  inicial,
  categorias,
  temMais: temMaisInicial,
}: {
  inicial: TransacaoLista[];
  categorias: CategoriaOpcao[];
  temMais: boolean;
}) {
  const router = useRouter();
  const [itens, setItens] = useState<TransacaoLista[]>(inicial);
  const [temMais, setTemMais] = useState(temMaisInicial);
  const [carregando, setCarregando] = useState(false);
  const [editando, setEditando] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
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
    setErro(null);
    const { data, error } = await createClient()
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
    setCarregando(false);
    if (error) {
      setErro(error.message);
      return;
    }
    const pagina = (data as TransacaoLista[]) ?? [];
    setItens((atual) => [...atual, ...pagina]);
    setTemMais(pagina.length === TAMANHO_PAGINA_TRANSACOES);
  }

  async function recategorizar(t: TransacaoLista, categoriaId: string, criarRegra: boolean) {
    setErro(null);
    const supabase = createClient();
    const { error } = await supabase.rpc("definir_categoria_transacao", {
      p_transacao_id: t.id,
      p_categoria_id: categoriaId || null,
      p_criar_regra: criarRegra,
      p_padrao: criarRegra ? t.descricao.trim().slice(0, 40) : null,
    });
    if (error) {
      setErro(mensagemDeErro(error));
      return;
    }
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
    if (!window.confirm(`Excluir ${ids.length} transação(ões)? Parcelas pendentes saem das faturas.`))
      return;
    setErro(null);
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
      setErro(
        `${excluidas.size} excluída(s); ${falhas} não puderam ser excluídas (ex.: parcela paga).`
      );
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
      {erro && (
        <p className="text-sm" style={{ color: "var(--telha)" }}>
          {erro}
        </p>
      )}

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
            <span className="font-medium">{t.descricao}</span>
            <span className="text-xs" style={{ color: "var(--grafite)" }}>
              {formatarData(t.data_compra)} · {t.forma_pagamento}
              {t.num_parcelas > 1 ? ` · ${t.num_parcelas}x` : ""}
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

      {temMais && (
        <button
          type="button"
          onClick={carregarMais}
          disabled={carregando}
          className="botao-fantasma mt-2 justify-self-center text-sm"
        >
          {carregando ? "Carregando..." : "Carregar mais"}
        </button>
      )}
    </div>
  );
}

function BotaoExcluir({
  id,
  descricao,
  aoExcluir,
}: {
  id: string;
  descricao: string;
  aoExcluir: (id: string) => void;
}) {
  const router = useRouter();
  const [pendente, setPendente] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function excluir() {
    if (!window.confirm(`Excluir "${descricao}"? Parcelas pendentes saem das faturas.`)) return;
    setErro(null);
    setPendente(true);
    const { error } = await createClient().rpc("excluir_transacao", { p_transacao_id: id });
    setPendente(false);
    if (error) {
      setErro(mensagemDeErro(error));
      return;
    }
    aoExcluir(id);
    router.refresh();
  }

  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        onClick={excluir}
        disabled={pendente}
        className="botao-fantasma botao-perigo text-xs"
      >
        {pendente ? "Excluindo..." : "Excluir"}
      </button>
      {erro && (
        <span className="text-xs" style={{ color: "var(--telha)" }}>
          {erro}
        </span>
      )}
    </span>
  );
}

function FormEdicao({
  transacao,
  aoFechar,
  aoSalvar,
}: {
  transacao: TransacaoLista;
  aoFechar: () => void;
  aoSalvar: (t: TransacaoLista) => void;
}) {
  const [descricao, setDescricao] = useState(transacao.descricao);
  const [valor, setValor] = useState((transacao.valor_total / 100).toFixed(2).replace(".", ","));
  const [data, setData] = useState(transacao.data_compra);
  const [pendente, setPendente] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);
    const centavos = paraCentavos(valor);
    if (!Number.isFinite(centavos)) {
      setErro("Valor inválido.");
      return;
    }
    setPendente(true);
    const { error } = await createClient().rpc("editar_transacao", {
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
    aoSalvar({ ...transacao, descricao: descricao.trim(), valor_total: centavos, data_compra: data });
  }

  return (
    <form
      onSubmit={salvar}
      className="vidro-soberano grid gap-2 px-4 py-3 sm:grid-cols-[1fr_auto_auto_auto_auto] sm:items-center"
    >
      <input
        value={descricao}
        onChange={(e) => setDescricao(e.target.value)}
        required
        className="campo-soberano !mt-0"
        aria-label="Descrição"
      />
      <input
        value={valor}
        onChange={(e) => setValor(e.target.value)}
        inputMode="decimal"
        className="campo-soberano !mt-0 !w-28"
        aria-label="Valor"
      />
      <input
        type="date"
        value={data}
        onChange={(e) => setData(e.target.value)}
        className="campo-soberano !mt-0 !w-auto"
        aria-label="Data da compra"
      />
      <button type="submit" disabled={pendente} className="botao-soberano text-xs">
        {pendente ? "Salvando..." : "Salvar"}
      </button>
      <button type="button" onClick={aoFechar} className="botao-fantasma text-xs">
        Cancelar
      </button>
      {erro && (
        <span className="text-xs sm:col-span-5" style={{ color: "var(--telha)" }}>
          {erro}
        </span>
      )}
    </form>
  );
}
