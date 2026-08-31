// Decisão de qual RPC usa a edição de transação — lógica pura, testada em
// tests/unit/edicao-transacao.test.ts.
//
// Editar uma transação não é uma operação só. São três, e escolher a errada
// custa caro nos dois sentidos:
//
// - editar_boleto: boleto tem valor variável e vencimento próprio, e não tem
//   tipo/forma/cartão/parcelas para trocar. RPC dedicada.
// - editar_transacao: barata, faz UPDATE nos campos e MANTÉM as parcelas
//   existentes. Só vale quando nada que afete o parcelamento mudou.
// - substituir_transacao: recria via motor completo (recalcula parcelas e
//   faturas). Necessária quando tipo/forma/cartão/parcelas/categoria mudam —
//   usar editar_transacao aqui deixaria as parcelas dessincronizadas do
//   cabeçalho, que é corrupção silenciosa de dado financeiro.
//
// A regra da categoria é a menos óbvia: mudar categoria sozinha já força
// substituir_transacao porque editar_transacao não recebe p_categoria_id —
// a categoria vive nas parcelas, que só o motor sabe reescrever.

/** Boleto é decidido pela forma ORIGINAL: o form de boleto não deixa trocá-la. */
export const FORMA_BOLETO = "BOLETO";
export const FORMA_CREDITO = "CREDITO";

export type EstrategiaEdicao =
  | "editar_boleto"
  | "editar_transacao"
  | "substituir_transacao";

/** Campos da transação como está no banco, antes da edição. */
export type TransacaoOriginal = {
  tipo: string;
  forma_pagamento: string;
  num_parcelas: number;
  categoria_id: string | null;
};

/** Campos como estão no formulário, depois da edição do usuário. */
export type EdicaoPretendida = {
  tipo: string;
  forma: string;
  /** String porque vem de <input type="number">; "" e lixo viram NaN. */
  numParcelas: string;
  /** "" no <select> significa "sem categoria", que é null no banco. */
  categoriaId: string;
};

/**
 * Normaliza o "" do <select> para o null do banco, para que a comparação
 * "mudou a categoria?" não dispare por diferença de representação.
 */
function normalizarCategoria(id: string | null | undefined): string | null {
  return id ? id : null;
}

/**
 * True quando só descrição/valor/data mudaram — o caso da RPC barata.
 * Parcelas só entram na conta se a forma pretendida for crédito: em débito,
 * pix e dinheiro o campo nem aparece no form e num_parcelas é sempre 1.
 */
export function soMudouCamposLeves(
  original: TransacaoOriginal,
  edicao: EdicaoPretendida,
): boolean {
  const viraCredito = edicao.forma === FORMA_CREDITO;
  return (
    edicao.tipo === original.tipo &&
    edicao.forma === original.forma_pagamento &&
    (!viraCredito || Number(edicao.numParcelas) === original.num_parcelas) &&
    normalizarCategoria(edicao.categoriaId) ===
      normalizarCategoria(original.categoria_id)
  );
}

/**
 * Qual RPC chamar. Boleto tem precedência sobre tudo: mesmo que o form
 * mostrasse outros campos, a transação continua sendo um boleto.
 */
export function decidirEstrategiaEdicao(
  original: TransacaoOriginal,
  edicao: EdicaoPretendida,
): EstrategiaEdicao {
  if (original.forma_pagamento === FORMA_BOLETO) return "editar_boleto";
  return soMudouCamposLeves(original, edicao)
    ? "editar_transacao"
    : "substituir_transacao";
}
