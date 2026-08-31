// Tipos e constantes compartilhados pelos três arquivos da lista de
// transações (index, form-edicao, botao-excluir). Vivem aqui, e não no
// index.tsx, para que os filhos não importem do pai — o ciclo
// index -> form-edicao -> index compila (os tipos somem no build), mas
// COLUNAS é valor de runtime e o ciclo passaria a ser real.

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
  /** 0023. LIQUIDACAO_FATURA não soma nas despesas — ver badge no render. */
  natureza: string | null;
};

export type CategoriaOpcao = { id: string; nome: string; tipo: string };
export type CartaoOpcao = { id: string; nome: string };

export const COLUNAS =
  "id, descricao, valor_total, tipo, forma_pagamento, data_compra, data_vencimento, num_parcelas, created_at, categoria_id, source, natureza";
