// Agregação de fluxo de caixa por competência — lógica pura, testada em
// tests/unit/fluxo.test.ts. Valores em centavos (convenção do projeto).

export type ParcelaFluxo = {
  valor: number;
  data_competencia: string; // ISO "YYYY-MM-DD"
  tipo: "DESPESA" | "RECEITA";
};

export type PontoFluxo = {
  mes: string; // "YYYY-MM"
  entradas: number;
  saidas: number;
  saldo: number;
  acumulado: number;
};

export type Anomalia = {
  mes: string;
  saidas: number;
  mediaAnterior: number;
};

/** Saídas do último mês estouram este múltiplo da média histórica => anomalia. */
const FATOR_ANOMALIA = 1.5;
/** Meses de histórico mínimos (além do corrente) para a média ter significado. */
const MINIMO_MESES_HISTORICO = 2;

export function agregarFluxoMensal(parcelas: ParcelaFluxo[]): PontoFluxo[] {
  const porMes = new Map<string, { entradas: number; saidas: number }>();
  for (const p of parcelas) {
    const mes = p.data_competencia.slice(0, 7);
    const atual = porMes.get(mes) ?? { entradas: 0, saidas: 0 };
    if (p.tipo === "RECEITA") atual.entradas += p.valor;
    else atual.saidas += p.valor;
    porMes.set(mes, atual);
  }

  let acumulado = 0;
  return [...porMes.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([mes, { entradas, saidas }]) => {
      const saldo = entradas - saidas;
      acumulado += saldo;
      return { mes, entradas, saidas, saldo, acumulado };
    });
}

export function detectarAnomalia(pontos: PontoFluxo[]): Anomalia | null {
  if (pontos.length < MINIMO_MESES_HISTORICO + 1) return null;
  const corrente = pontos[pontos.length - 1];
  const historico = pontos.slice(0, -1);
  const mediaAnterior =
    historico.reduce((soma, p) => soma + p.saidas, 0) / historico.length;
  if (mediaAnterior <= 0) return null;
  if (corrente.saidas <= mediaAnterior * FATOR_ANOMALIA) return null;
  return { mes: corrente.mes, saidas: corrente.saidas, mediaAnterior };
}
