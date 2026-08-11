// Parse de extrato OFX/OFC na borda da UI — lógica pura, testada em
// tests/unit/ofx.test.ts. OFX 1.x é SGML (tags sem fechamento); OFX 2.x é
// XML; OFC é o antecessor do MS Money com as mesmas tags de lançamento.
// O parser é tolerante: fatia o texto em blocos de lançamento e lê tag a
// tag, sem exigir árvore bem-formada. Saída: LinhaImportacao (centavos com
// sinal), o mesmo contrato do CSV — desemboca no staging da 0009.

import type { LinhaImportacao, ResultadoParse } from "./csv.ts";
import { paraCentavosAssinado } from "./money.ts";

/** Valor de uma tag SGML/XML: `<TAG>valor` (fechamento opcional). */
function valorTag(bloco: string, tag: string): string | null {
  const m = bloco.match(new RegExp(`<${tag}>([^<\\r\\n]*)`, "i"));
  const v = m?.[1].trim();
  return v ? v : null;
}

/** "20260705120000[-3:BRT]" | "20260705" -> "2026-07-05"; null se inválida. */
export function dataOfxParaIso(bruta: string): string | null {
  const m = bruta.trim().match(/^(\d{4})(\d{2})(\d{2})/);
  if (!m) return null;
  const [, ano, mes, dia] = m;
  if (Number(mes) < 1 || Number(mes) > 12 || Number(dia) < 1 || Number(dia) > 31) return null;
  return `${ano}-${mes}-${dia}`;
}

/**
 * TRNAMT "-89.90" | "-89,90" | "1.234,56" | "1234.56" -> centavos com sinal.
 * Delega ao parser único de money.ts — antes uma regex local rejeitava valores
 * com separador de milhar que o parser de CSV aceitava (divergência corrigida).
 */
export function valorOfxParaCentavos(bruto: string): number | null {
  return paraCentavosAssinado(bruto);
}

// Entidades comuns em MEMO/NAME de banco.
function decodificarEntidades(s: string): string {
  return s
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'");
}

/**
 * OFX e OFC no mesmo parser. Blocos de lançamento: <STMTTRN> (OFX/OFC) ou
 * <TRANSACTION> (variantes OFC); sem nenhum marcador, cai no fatiamento por
 * <DTPOSTED> — cada lançamento tem exatamente um.
 */
export function parseOfxExtrato(conteudo: string): ResultadoParse {
  let blocos = conteudo.split(/<STMTTRN>/i).slice(1);
  if (blocos.length === 0) blocos = conteudo.split(/<TRANSACTION>/i).slice(1);
  if (blocos.length === 0) blocos = conteudo.split(/(?=<DTPOSTED>)/i).slice(1);

  const linhas: LinhaImportacao[] = [];
  let descartadas = 0;
  for (const bloco of blocos) {
    const data = dataOfxParaIso(valorTag(bloco, "DTPOSTED") ?? "");
    const valor = valorOfxParaCentavos(valorTag(bloco, "TRNAMT") ?? "");
    const descricao = decodificarEntidades(
      valorTag(bloco, "MEMO") ?? valorTag(bloco, "NAME") ?? "",
    ).trim();
    if (!data || valor === null || descricao === "") {
      descartadas++;
      continue;
    }
    // FITID é o identificador que o próprio banco dá ao lançamento e é
    // estável entre exportações do mesmo extrato — dedup por ele é fato,
    // não heurística. Antes era descartado aqui; a 0020 passou a usá-lo.
    const fitid = valorTag(bloco, "FITID");
    linhas.push(fitid ? { data, valor, descricao, id_externo: fitid } : { data, valor, descricao });
  }
  return { linhas, descartadas };
}
