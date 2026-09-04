"use client";

// Uma linha do histórico. Era o corpo do .map() em index.tsx — o trecho de
// maior complexidade do arquivo, entre selos condicionais, rótulo variável e
// os dois formatos de valor.

import { formatarCentavos, formatarCentavosAcessivel, formatarData } from "@/lib/money";
import { BotaoExcluir } from "@/components/lista-transacoes/botao-excluir";
import type { TransacaoLista, CategoriaOpcao } from "@/components/lista-transacoes/tipos";

/** Boleto se identifica pelo vencimento; o resto, por data · forma · parcelas. */
function rotuloDoMeio(t: TransacaoLista): string {
  if (t.forma_pagamento === "BOLETO") {
    return t.data_vencimento ? `Boleto · vence ${formatarData(t.data_vencimento)}` : "Boleto";
  }
  const parcelas = t.num_parcelas > 1 ? ` · ${t.num_parcelas}x` : "";
  return `${formatarData(t.data_compra)} · ${t.forma_pagamento}${parcelas}`;
}

function Selo({ texto, cor, titulo }: { texto: string; cor: string; titulo: string }) {
  return (
    <span
      className="ml-2 rounded px-1.5 py-0.5 align-middle text-[10px] font-normal uppercase tracking-wide"
      style={{ color: cor, border: `1px solid ${cor}` }}
      title={titulo}
    >
      {texto}
    </span>
  );
}

export function LinhaTransacao({
  transacao: t,
  categorias,
  selecionada,
  onAlternarSelecao,
  onRecategorizar,
  onEditar,
  onExcluir,
}: {
  transacao: TransacaoLista;
  categorias: CategoriaOpcao[];
  selecionada: boolean;
  onAlternarSelecao: (id: string) => void;
  onRecategorizar: (t: TransacaoLista, categoriaId: string, criarRegra: boolean) => void;
  onEditar: (id: string) => void;
  onExcluir: (id: string) => void;
}) {
  const ehReceita = t.tipo === "RECEITA";
  // Marcar "MANUAL" em tudo que foi digitado é ruído; NULL seria mentira.
  const origemImportada = t.source && t.source !== "MANUAL";

  return (
    <div
      className="vidro-soberano flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3"
      style={selecionada ? { borderColor: "var(--ouro)" } : undefined}
    >
      <input
        type="checkbox"
        checked={selecionada}
        onChange={() => onAlternarSelecao(t.id)}
        aria-label={`Selecionar ${t.descricao}`}
      />
      <span className="font-medium">
        {t.descricao}
        {t.natureza === "LIQUIDACAO_FATURA" && (
          <Selo
            texto="Liquidação de fatura"
            cor="var(--ouro)"
            titulo="Pagamento de fatura de cartão. Não soma nas despesas — as compras já foram contadas quando aconteceram."
          />
        )}
        {origemImportada && (
          <Selo texto={t.source!} cor="var(--grafite)" titulo={`Importado de ${t.source}`} />
        )}
      </span>
      <span className="text-xs" style={{ color: "var(--grafite)" }}>
        {rotuloDoMeio(t)}
      </span>

      <select
        value={t.categoria_id ?? ""}
        onChange={(e) => onRecategorizar(t, e.target.value, false)}
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
          onClick={() => onRecategorizar(t, t.categoria_id!, true)}
        >
          criar regra
        </button>
      )}

      <span
        className="numero-soberano ml-auto font-medium"
        style={{ color: ehReceita ? "var(--verde)" : "var(--giz)" }}
        aria-label={`${ehReceita ? "entrada de" : "saída de"} ${formatarCentavosAcessivel(t.valor_total)}`}
      >
        {ehReceita ? "+" : "-"}
        {formatarCentavos(t.valor_total)}
      </span>
      <button type="button" className="botao-fantasma text-xs" onClick={() => onEditar(t.id)}>
        Editar
      </button>
      <BotaoExcluir id={t.id} descricao={t.descricao} aoExcluir={onExcluir} />
    </div>
  );
}
