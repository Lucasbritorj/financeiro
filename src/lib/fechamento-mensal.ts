export type CategoriaOrcamento = { orcamento_mensal: number | null };
export type CofrinhoFechamento = {
  saldo_atual: number;
  valor_alvo: number;
  data_alvo: string | null;
};

/** Agregado puro do fechamento: leitura de dados existentes, sem movimentar dinheiro. */
export function montarFechamentoMensal(args: {
  realizado: number;
  projecao: number;
  categorias: CategoriaOrcamento[];
  cofrinhos: CofrinhoFechamento[];
}) {
  const orcamentoTotal = args.categorias.reduce(
    (total, categoria) => total + (categoria.orcamento_mensal ?? 0),
    0,
  );
  const temOrcamento = args.categorias.some((categoria) => categoria.orcamento_mensal != null);
  const saldoMetas = args.cofrinhos.reduce((total, cofrinho) => total + cofrinho.saldo_atual, 0);
  const alvoMetas = args.cofrinhos.reduce((total, cofrinho) => total + cofrinho.valor_alvo, 0);

  return {
    realizado: args.realizado,
    projecao: args.projecao,
    orcamentoTotal,
    diferencaOrcamento: temOrcamento ? orcamentoTotal - args.projecao : null,
    quantidadeMetas: args.cofrinhos.length,
    saldoMetas,
    alvoMetas,
  };
}