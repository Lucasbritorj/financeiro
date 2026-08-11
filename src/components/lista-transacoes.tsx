"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { formatarCentavos, formatarCentavosAcessivel, formatarData, paraCentavos, centavosParaDecimalEditavel } from "@/lib/money";
import { mensagemDeErro } from "@/lib/erros";
import { TAMANHO_PAGINA_TRANSACOES } from "@/lib/constantes";
import {
  aplicarFiltrosTransacoes,
  type FiltrosTransacoes,
} from "@/lib/filtros-transacoes";
import { useToast, useConfirm } from "@/components/feedback";

export type TransacaoLista = {
  id: string;
  descricao: string;
  valor_total: number;
  tipo: string;
  forma_pagamento: string;
  data_compra: string;
  data_vencimento: string | null;
  num_parcelas: number;
  created_at: string;
  categoria_id: string | null;
  /**
   * 0021. NULL = histórico anterior à coluna (proveniência desconhecida);
   * MANUAL = lançado à mão. Só os demais rendem badge — marcar "MANUAL" em
   * tudo que foi digitado é ruído, e marcar NULL seria mentira.
   */
  source: string | null;
};

type CategoriaOpcao = { id: string; nome: string; tipo: string };
type CartaoOpcao = { id: string; nome: string };

const COLUNAS =
  "id, descricao, valor_total, tipo, forma_pagamento, data_compra, data_vencimento, num_parcelas, created_at, categoria_id, source";

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
  const notificar = useToast();
  const confirmar = useConfirm();
  const [pendente, setPendente] = useState(false);

  async function excluir() {
    const ok = await confirmar({
      titulo: "Excluir transação",
      mensagem: `Excluir "${descricao}"? Parcelas pendentes saem das faturas.`,
      rotuloConfirmar: "Excluir",
      perigo: true,
    });
    if (!ok) return;
    setPendente(true);
    const { error } = await createClient().rpc("excluir_transacao", { p_transacao_id: id });
    setPendente(false);
    if (error) {
      notificar(mensagemDeErro(error), "erro");
      return;
    }
    notificar("Transação excluída.", "sucesso");
    aoExcluir(id);
    router.refresh();
  }

  return (
    <button
      type="button"
      onClick={excluir}
      disabled={pendente}
      className="botao-fantasma botao-perigo text-xs"
    >
      {pendente ? "Excluindo..." : "Excluir"}
    </button>
  );
}

// Edição completa: além de descrição/valor/data, permite trocar tipo, forma
// de pagamento, cartão e parcelas. Quando só mudam descrição/valor/data usa
// editar_transacao (barato, mantém as parcelas); quando muda tipo/forma/
// cartão/parcelas usa substituir_transacao (recria via motor completo).
function FormEdicao({
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

  const ehCredito = forma === "CREDITO";
  const ehBoleto = transacao.forma_pagamento === "BOLETO";
  const categoriasDoTipo = categorias.filter((c) => c.tipo === tipo);

  // Só descrição/valor/data mudaram => edição barata (mantém parcelas).
  const soCamposLeves =
    tipo === transacao.tipo &&
    forma === transacao.forma_pagamento &&
    (!ehCredito || Number(numParcelas) === transacao.num_parcelas) &&
    (categoriaId || null) === (transacao.categoria_id ?? null);

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
    if (ehBoleto) {
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

    if (soCamposLeves) {
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
