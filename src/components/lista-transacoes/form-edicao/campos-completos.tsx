"use client";

// Formulário completo: além de descrição/valor/data, permite trocar tipo,
// forma de pagamento, cartão e parcelas. Trocar qualquer um destes leva à RPC
// que RECRIA a transação — daí o aviso quando a edição deixa de ser barata.

import { RodapeEdicao } from "./rodape";
import type { Campos } from "./use-edicao";
import type { CategoriaOpcao, CartaoOpcao } from "@/components/lista-transacoes/tipos";

export function CamposCompletos({
  campos,
  definir,
  categorias,
  cartoes,
  ehCredito,
  soCamposLeves,
  erro,
  pendente,
  aoFechar,
  aoSubmeter,
}: {
  campos: Campos;
  definir: <K extends keyof Campos>(campo: K, valor: Campos[K]) => void;
  categorias: CategoriaOpcao[];
  cartoes: CartaoOpcao[];
  ehCredito: boolean;
  soCamposLeves: boolean;
  erro: string | null;
  pendente: boolean;
  aoFechar: () => void;
  aoSubmeter: (e: React.FormEvent) => void;
}) {
  // Categoria de RECEITA não pode ser escolhida numa despesa, e vice-versa.
  const categoriasDoTipo = categorias.filter((c) => c.tipo === campos.tipo);

  return (
    <form onSubmit={aoSubmeter} className="vidro-soberano grid gap-3 p-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm sm:col-span-2">
          Descrição
          <input
            value={campos.descricao}
            onChange={(e) => definir("descricao", e.target.value)}
            required
            className="campo-soberano"
            aria-label="Descrição"
          />
        </label>
        <label className="text-sm">
          Valor (R$)
          <input
            value={campos.valor}
            onChange={(e) => definir("valor", e.target.value)}
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
            value={campos.data}
            onChange={(e) => definir("data", e.target.value)}
            className="campo-soberano"
            aria-label="Data da compra"
          />
        </label>
        <label className="text-sm">
          Tipo
          <select
            value={campos.tipo}
            onChange={(e) => definir("tipo", e.target.value)}
            className="campo-soberano"
          >
            <option value="DESPESA">Despesa</option>
            <option value="RECEITA">Receita</option>
          </select>
        </label>
        <label className="text-sm">
          Forma de pagamento
          <select
            value={campos.forma}
            onChange={(e) => definir("forma", e.target.value)}
            className="campo-soberano"
          >
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
                value={campos.cartaoId}
                onChange={(e) => definir("cartaoId", e.target.value)}
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
                value={campos.numParcelas}
                onChange={(e) => definir("numParcelas", e.target.value)}
                className="campo-soberano"
              />
            </label>
          </>
        )}
        {categorias.length > 0 && (
          <label className="text-sm">
            Categoria
            <select
              value={campos.categoriaId}
              onChange={(e) => definir("categoriaId", e.target.value)}
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
      <RodapeEdicao erro={erro} pendente={pendente} aoFechar={aoFechar} />
    </form>
  );
}
