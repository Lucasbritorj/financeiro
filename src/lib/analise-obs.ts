// Primitivas de observação: como uma Observacao é construída e pontuada, mais
// os agregados que vários detectores compartilham. As regras que decidem
// QUANDO observar vivem em analise-detectores.ts.
//
// O import de analise.ts é `import type` — some na compilação, sem ciclo.

import type { TransacaoInsight, SegmentoFrase } from "./insights.ts";
import type { Observacao, Severidade } from "./analise.ts";

// Peso base por severidade; magnitude entra como bônus para ordenar
// alertas mais graves acima de alertas leves.
const PESO: Record<Severidade, number> = {
  alerta: 1000,
  atencao: 500,
  positivo: 250,
  neutro: 100,
};

export type NovaObservacao = {
  id: string; // slug estável (tipo + chave) para React key
  severidade: Severidade;
  titulo: string;
  segmentos: SegmentoFrase[];
  /** Bônus de ranking dentro da faixa da severidade. */
  magnitude?: number;
  /** Número destacado opcional, ex "-32%". */
  metrica?: string;
};

/**
 * A magnitude é limitada a `PESO[severidade] - 1`: um "positivo" com número
 * enorme nunca sobe para a faixa de "atenção". A severidade manda no ranking;
 * a magnitude só desempata dentro dela.
 */
export function obs(o: NovaObservacao): Observacao {
  const base = PESO[o.severidade];
  return {
    id: o.id,
    severidade: o.severidade,
    titulo: o.titulo,
    segmentos: o.segmentos,
    metrica: o.metrica,
    pontuacao: base + Math.min(o.magnitude ?? 0, base - 1),
  };
}

/** Lista de "YYYY-MM" dos n meses anteriores a mesISO (mais recente primeiro). */
export function mesesAnteriores(mesISO: string, n: number): string[] {
  const [ano, mes] = mesISO.split("-").map(Number);
  const saida: string[] = [];
  for (let i = 1; i <= n; i++) {
    const d = new Date(Date.UTC(ano, mes - 1 - i, 1));
    saida.push(d.toISOString().slice(0, 7));
  }
  return saida;
}

export function fmtPct(n: number): string {
  return `${n > 0 ? "+" : ""}${n}%`;
}

// Gasto (DESPESA) por categoria e por mês: Map<nomeCategoria, Map<mes, centavos>>.
export function despesaCategoriaPorMes(
  transacoes: TransacaoInsight[],
): Map<string, Map<string, number>> {
  const mapa = new Map<string, Map<string, number>>();
  for (const t of transacoes) {
    if (t.tipo !== "DESPESA") continue;
    const nome = t.categoria?.nome ?? "Sem categoria";
    const mes = t.data_compra.slice(0, 7);
    const porMes = mapa.get(nome) ?? new Map<string, number>();
    porMes.set(mes, (porMes.get(mes) ?? 0) + t.valor_total);
    mapa.set(nome, porMes);
  }
  return mapa;
}

export function media(valores: number[]): number {
  if (valores.length === 0) return 0;
  return Math.round(valores.reduce((s, v) => s + v, 0) / valores.length);
}

export type Ctx = {
  mesISO: string;
  hojeISO: string;
  formatar: (centavos: number) => string;
};

export type Detector = (t: TransacaoInsight[], c: Ctx) => Observacao[];
