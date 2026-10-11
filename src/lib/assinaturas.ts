export const PERIODICIDADES = [
  "MENSAL",
  "TRIMESTRAL",
  "SEMESTRAL",
  "ANUAL",
] as const;

export type PeriodicidadeAssinatura = (typeof PERIODICIDADES)[number];
export type StatusAssinatura = "ATIVA" | "PAUSADA" | "CANCELADA";

export type AssinaturaCalculavel = {
  valor: number;
  periodicidade: PeriodicidadeAssinatura;
  proxima_data: string;
  status: StatusAssinatura;
};

type AssinaturaComCartao = AssinaturaCalculavel & {
  descricao: string;
  cartao_id: string | null;
};

type CartaoIdentificavel = {
  id: string;
  nome: string;
};

const MESES_POR_CICLO: Record<PeriodicidadeAssinatura, number> = {
  MENSAL: 1,
  TRIMESTRAL: 3,
  SEMESTRAL: 6,
  ANUAL: 12,
};

const ROTULOS: Record<PeriodicidadeAssinatura, string> = {
  MENSAL: "Mensal",
  TRIMESTRAL: "Trimestral",
  SEMESTRAL: "Semestral",
  ANUAL: "Anual",
};

export function rotuloPeriodicidade(periodicidade: PeriodicidadeAssinatura): string {
  return ROTULOS[periodicidade];
}

/** Valor médio mensal em centavos, arredondado apenas na borda de exibição. */
export function custoMensalEquivalente(
  valor: number,
  periodicidade: PeriodicidadeAssinatura,
): number {
  return Math.round(valor / MESES_POR_CICLO[periodicidade]);
}

/** Projeção de doze meses; todos os ciclos suportados dividem o ano exatamente. */
export function projecaoAnual(
  valor: number,
  periodicidade: PeriodicidadeAssinatura,
): number {
  return valor * (12 / MESES_POR_CICLO[periodicidade]);
}

export function resumirAssinaturas(assinaturas: readonly AssinaturaCalculavel[]) {
  const ativas = assinaturas.filter((assinatura) => assinatura.status === "ATIVA");
  const custoAnual = ativas.reduce(
    (total, assinatura) =>
      total + projecaoAnual(assinatura.valor, assinatura.periodicidade),
    0,
  );
  return {
    quantidadeAtivas: ativas.length,
    custoMensal: Math.round(custoAnual / 12),
    custoAnual,
  };
}

export function impactoPorCartao(
  assinaturas: readonly AssinaturaComCartao[],
  cartoes: readonly CartaoIdentificavel[],
) {
  const nomesPorCartao = new Map(cartoes.map((cartao) => [cartao.id, cartao.nome]));
  const ativas = assinaturas.filter((assinatura) => assinatura.status === "ATIVA");
  const custoAnualTotal = ativas.reduce(
    (total, assinatura) =>
      total + projecaoAnual(assinatura.valor, assinatura.periodicidade),
    0,
  );

  if (custoAnualTotal === 0) return [];

  const assinaturasPorCartao = new Map<string | null, AssinaturaComCartao[]>();
  for (const assinatura of ativas) {
    const grupo = assinaturasPorCartao.get(assinatura.cartao_id) ?? [];
    grupo.push(assinatura);
    assinaturasPorCartao.set(assinatura.cartao_id, grupo);
  }

  const grupos = Array.from(assinaturasPorCartao, ([cartaoId, assinaturasDoCartao]) => {
    const assinaturasProjetadas = assinaturasDoCartao.map((assinatura) => ({
      descricao: assinatura.descricao,
      custoAnual: projecaoAnual(assinatura.valor, assinatura.periodicidade),
    }));
    const custoAnual = assinaturasProjetadas.reduce(
      (total, assinatura) => total + assinatura.custoAnual,
      0,
    );
    const principaisAssinaturas = assinaturasProjetadas
      .slice()
      .sort(
        (a, b) =>
          b.custoAnual - a.custoAnual ||
          a.descricao.localeCompare(b.descricao, "pt-BR"),
      )
      .slice(0, 3);

    return {
      cartaoId,
      nomeCartao: cartaoId
        ? (nomesPorCartao.get(cartaoId) ?? "Cartão removido")
        : "Sem cartão",
      quantidadeAtivas: assinaturasDoCartao.length,
      custoMensal: custoMensalEquivalente(custoAnual, "ANUAL"),
      custoAnual,
      principaisAssinaturas,
    };
  }).sort((a, b) => b.custoAnual - a.custoAnual);

  const totalDecimosPercentuais = 1000;
  const totalInteiro = BigInt(custoAnualTotal);
  const participacoes = grupos.map((grupo) => {
    const numerador = BigInt(grupo.custoAnual) * BigInt(totalDecimosPercentuais);
    return {
      participacaoPercentual: Number(numerador / totalInteiro),
      resto: numerador % totalInteiro,
    };
  });
  const decimosRestantes = totalDecimosPercentuais - participacoes.reduce(
    (total, participacao) => total + participacao.participacaoPercentual,
    0,
  );
  const ordemPorMaiorResto = participacoes
    .map((_, indice) => indice)
    .sort((a, b) => {
      if (participacoes[a].resto === participacoes[b].resto) return a - b;
      return participacoes[a].resto > participacoes[b].resto ? -1 : 1;
    });

  for (let indice = 0; indice < decimosRestantes; indice += 1) {
    participacoes[ordemPorMaiorResto[indice]].participacaoPercentual += 1;
  }

  return grupos.map((grupo, indice) => ({
    ...grupo,
    participacaoPercentual: participacoes[indice].participacaoPercentual,
  }));
}

export function proximasCobrancas<T extends AssinaturaCalculavel>(
  assinaturas: readonly T[],
  limite = 5,
): T[] {
  return assinaturas
    .filter((assinatura) => assinatura.status === "ATIVA")
    .slice()
    .sort((a, b) => a.proxima_data.localeCompare(b.proxima_data))
    .slice(0, limite);
}
