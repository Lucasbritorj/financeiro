// Dinheiro trafega como CENTAVOS (inteiro). Conversão só na borda da UI.

/** "1.234,56", "1234.56" ou "1234" -> centavos (inteiro). NaN se inválido/<= 0. */
export function paraCentavos(entrada: string): number {
  let s = entrada.replace(/[R$\s]/g, "");
  if (!s) return NaN;
  if (s.includes(",")) {
    // formato pt-BR: ponto = milhar, vírgula = decimal
    s = s.replace(/\./g, "").replace(",", ".");
  } else {
    const partes = s.split(".");
    // um ponto seguido de 3 dígitos (ou vários pontos) = separador de milhar
    if (partes.length > 2 || (partes.length === 2 && partes[1].length === 3)) {
      s = partes.join("");
    }
  }
  const valor = Number(s);
  if (!Number.isFinite(valor) || valor <= 0) return NaN;
  return Math.round(valor * 100);
}

export function formatarCentavos(centavos: number): string {
  return (centavos / 100).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

/** "2026-02-01" -> "fev/2026" */
export function formatarCompetencia(isoDate: string): string {
  const [ano, mes] = isoDate.split("-").map(Number);
  const nomes = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
  return `${nomes[mes - 1]}/${ano}`;
}

/** "2026-02-28" -> "28/02/2026" */
export function formatarData(isoDate: string): string {
  const [ano, mes, dia] = isoDate.split("-");
  return `${dia}/${mes}/${ano}`;
}
