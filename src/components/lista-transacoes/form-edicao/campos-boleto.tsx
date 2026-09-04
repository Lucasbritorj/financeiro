"use client";

// Formulário dedicado ao boleto: sem tipo, forma, cartão ou parcelas — a RPC
// editar_boleto não troca nada disso, e oferecer os campos convidaria a uma
// edição que o servidor ignoraria. Em troca, tem vencimento e competência.

import { RodapeEdicao } from "./rodape";
import type { Campos } from "./use-edicao";
import type { CategoriaOpcao } from "@/components/lista-transacoes/tipos";

export function CamposBoleto({
  campos,
  definir,
  categorias,
  erro,
  pendente,
  aoFechar,
  aoSubmeter,
}: {
  campos: Campos;
  definir: <K extends keyof Campos>(campo: K, valor: Campos[K]) => void;
  categorias: CategoriaOpcao[];
  erro: string | null;
  pendente: boolean;
  aoFechar: () => void;
  aoSubmeter: (e: React.FormEvent) => void;
}) {
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
            aria-label="Descrição do boleto"
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
            aria-label="Valor do boleto"
          />
        </label>
        <label className="text-sm">
          Vencimento
          <input
            type="date"
            value={campos.vencimento}
            onChange={(e) => definir("vencimento", e.target.value)}
            required
            className="campo-soberano"
            aria-label="Vencimento"
          />
        </label>
        <label className="text-sm">
          Competência (mês de referência)
          <input
            type="date"
            value={campos.data}
            onChange={(e) => definir("data", e.target.value)}
            className="campo-soberano"
            aria-label="Competência"
          />
        </label>
        {categorias.length > 0 && (
          <label className="text-sm">
            Categoria
            <select
              value={campos.categoriaId}
              onChange={(e) => definir("categoriaId", e.target.value)}
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
      <RodapeEdicao erro={erro} pendente={pendente} aoFechar={aoFechar} />
    </form>
  );
}
