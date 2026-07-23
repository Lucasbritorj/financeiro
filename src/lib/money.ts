// Dinheiro trafega como CENTAVOS (inteiro). Conversão só na borda da UI.
// Fonte ÚNICA de verdade da conversão decimal<->centavos: todo parser de
// importação (csv/ofx/pdf/planilha) e toda edição de valor na UI delega a
// `paraCentavosAssinado`. Não reimplemente `Math.round(n*100)` em outro arquivo.

/**
 * Parser tolerante de valor monetário pt-BR/US COM sinal -> centavos (inteiro).
 * Aceita "1.234,56", "-1234.56", "R$ 10,00", "+89,90", "89,90". Trata ponto
 * como milhar quando seguido de 3 dígitos (ou repetido) e vírgula como decimal.
 * Retorna null para entrada inválida ou que arredonde a zero.
 */
export function paraCentavosAssinado(entrada: string): number | null {
  let s = entrada.replace(/[R$\s"]/g, "");
  if (!s) return null;
  let sinal = 1;
  if (s.startsWith("-")) {
    sinal = -1;
    s = s.slice(1);
  } else if (s.startsWith("+")) {
    s = s.slice(1);
  }
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
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  // Além de 2 casas: arredonda ao centavo (meio para cima).
  const centavos = Math.round(n * 100) * sinal;
  return centavos === 0 ? null : centavos;
}

/** Entrada de valor POSITIVO da UI -> centavos. NaN se inválido/<= 0. */
export function paraCentavos(entrada: string): number {
  const centavos = paraCentavosAssinado(entrada);
  return centavos !== null && centavos > 0 ? centavos : NaN;
}

/** centavos -> "1234,56" (sem prefixo de moeda), para preencher campo editável. */
export function centavosParaDecimalEditavel(centavos: number): string {
  return (centavos / 100).toFixed(2).replace(".", ",");
}

export function formatarCentavos(centavos: number): string {
  return (centavos / 100).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

/**
 * centavos -> texto explícito para leitor de tela (aria-label). Ex.: 123456 ->
 * "1.234 reais e 56 centavos"; -8990 -> "menos 89 reais e 90 centavos".
 * Evita que o leitor soletre "R cifrão" ou leia o símbolo de forma ambígua.
 */
export function formatarCentavosAcessivel(centavos: number): string {
  const negativo = centavos < 0;
  const abs = Math.abs(centavos);
  const reais = Math.trunc(abs / 100);
  const cent = abs % 100;
  const parteReais = reais === 1 ? "1 real" : `${reais.toLocaleString("pt-BR")} reais`;
  const parteCent = cent === 0 ? "" : cent === 1 ? " e 1 centavo" : ` e ${cent} centavos`;
  return `${negativo ? "menos " : ""}${parteReais}${parteCent}`;
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
