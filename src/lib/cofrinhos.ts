// Projeção de cofrinhos — lógica pura, testada em tests/unit/cofrinhos.test.ts.
// O banco (0010) guarda fatos (saldo, alvo, data); ritmo/status/projeção
// são derivados aqui. Valores em centavos.

export type CofrinhoProjecao = {
  valor_alvo: number;
  saldo_atual: number;
  data_alvo: string | null; // ISO "YYYY-MM-DD"
};

export type MovimentacaoCofrinho = {
  valor: number;
  tipo: "APORTE" | "RESGATE";
  data: string; // ISO
};

export type StatusCofrinho = "no_ritmo" | "atrasado" | "adiantado" | "completo" | "sem_meta";

/** Meses inteiros entre hoje e a data-alvo (mínimo 1 quando futura). */
export function mesesAte(hojeISO: string, alvoISO: string): number {
  const [ha, hm] = [Number(hojeISO.slice(0, 4)), Number(hojeISO.slice(5, 7))];
  const [aa, am] = [Number(alvoISO.slice(0, 4)), Number(alvoISO.slice(5, 7))];
  return Math.max((aa - ha) * 12 + (am - hm), 1);
}

/** Aporte mensal necessário para bater o alvo na data; null sem data-alvo. */
export function ritmoNecessario(c: CofrinhoProjecao, hojeISO: string): number | null {
  if (!c.data_alvo) return null;
  const falta = c.valor_alvo - c.saldo_atual;
  if (falta <= 0) return 0;
  return Math.ceil(falta / mesesAte(hojeISO, c.data_alvo));
}

/** Média mensal de aportes líquidos nos últimos `janelaMeses` (default 3). */
export function ritmoReal(
  movimentacoes: MovimentacaoCofrinho[],
  hojeISO: string,
  janelaMeses = 3
): number {
  const corte = new Date(hojeISO);
  corte.setUTCMonth(corte.getUTCMonth() - janelaMeses);
  const corteISO = corte.toISOString().slice(0, 10);
  let liquido = 0;
  for (const m of movimentacoes) {
    if (m.data <= corteISO || m.data > hojeISO) continue;
    liquido += m.tipo === "APORTE" ? m.valor : -m.valor;
  }
  return Math.max(Math.round(liquido / janelaMeses), 0);
}

export function statusCofrinho(
  c: CofrinhoProjecao,
  movimentacoes: MovimentacaoCofrinho[],
  hojeISO: string
): StatusCofrinho {
  if (c.saldo_atual >= c.valor_alvo) return "completo";
  const necessario = ritmoNecessario(c, hojeISO);
  if (necessario === null) return "sem_meta";
  const real = ritmoReal(movimentacoes, hojeISO);
  if (real >= necessario * 1.15) return "adiantado";
  if (real >= necessario) return "no_ritmo";
  return "atrasado";
}

/** "YYYY-MM" projetado de conclusão pelo ritmo real; null se ritmo 0. */
export function dataProjetada(
  c: CofrinhoProjecao,
  movimentacoes: MovimentacaoCofrinho[],
  hojeISO: string
): string | null {
  const falta = c.valor_alvo - c.saldo_atual;
  if (falta <= 0) return hojeISO.slice(0, 7);
  const real = ritmoReal(movimentacoes, hojeISO);
  if (real <= 0) return null;
  const meses = Math.ceil(falta / real);
  const d = new Date(hojeISO);
  d.setUTCMonth(d.getUTCMonth() + meses);
  return d.toISOString().slice(0, 7);
}

/** Progresso 0..100 (inteiro, clampado). */
export function progressoPct(c: CofrinhoProjecao): number {
  if (c.valor_alvo <= 0) return 0;
  return Math.min(Math.round((c.saldo_atual / c.valor_alvo) * 100), 100);
}
