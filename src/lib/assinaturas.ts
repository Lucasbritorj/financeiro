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
