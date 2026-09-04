"use client";

// Edição completa de transação. Só compõe: o estado e as três RPCs vivem em
// use-edicao.ts, e cada formulário é um componente de apresentação.

import { useEdicao } from "./use-edicao";
import { CamposBoleto } from "./campos-boleto";
import { CamposCompletos } from "./campos-completos";
import type {
  TransacaoLista,
  CategoriaOpcao,
  CartaoOpcao,
} from "@/components/lista-transacoes/tipos";

export function FormEdicao({
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
  const { campos, definir, ehCredito, ehBoleto, soCamposLeves, pendente, erro, salvar } =
    useEdicao({ transacao, cartoes, aoSalvar });

  if (ehBoleto) {
    return (
      <CamposBoleto
        campos={campos}
        definir={definir}
        categorias={categorias}
        erro={erro}
        pendente={pendente}
        aoFechar={aoFechar}
        aoSubmeter={salvar}
      />
    );
  }

  return (
    <CamposCompletos
      campos={campos}
      definir={definir}
      categorias={categorias}
      cartoes={cartoes}
      ehCredito={ehCredito}
      soCamposLeves={soCamposLeves}
      erro={erro}
      pendente={pendente}
      aoFechar={aoFechar}
      aoSubmeter={salvar}
    />
  );
}
