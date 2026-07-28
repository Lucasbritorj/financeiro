// Data de "hoje" no fuso de negócio (America/Sao_Paulo) — lógica pura,
// testada em tests/unit/data.test.ts. Usada só como default de formulário e
// leitura no cliente (ex.: preencher o campo de data com o dia de hoje); a
// REGRA de negócio (fechamento, competência, vencimento) continua no SQL com
// America/Sao_Paulo, como sempre. Extraída de 8 cópias idênticas espalhadas
// pelo código-base (T-06) — usa Intl nativo, não uma lib de data.

/** "YYYY-MM-DD" de hoje no fuso America/Sao_Paulo. */
export function hojeSaoPaulo(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
}
