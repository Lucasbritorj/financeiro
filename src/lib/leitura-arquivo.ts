// Leitura de arquivo de extrato no navegador: decodificação, hash e os
// decoders de XLSX/PDF. Tudo aqui toca API de browser (File, TextDecoder,
// crypto.subtle, import dinâmico), por isso mora fora de importacao-preview.ts,
// que é lógica pura e roda no test runner sem DOM.
//
// O dispatch por origem vive aqui, e não em importacao-preview.ts, justamente
// porque cada parser tem assinatura e efeito colateral diferentes — texto,
// matriz ou páginas de PDF.

import {
  parseCsvExtrato,
  parseMatrizExtrato,
  type PresetBanco,
  type ResultadoParse,
} from "./csv.ts";
import { parseOfxExtrato } from "./ofx.ts";
import { parsePdfExtrato } from "./pdf-extrato.ts";
import type { OrigemImportacao } from "./importacao-preview.ts";

/**
 * Ano de referência do extrato PDF: o ano de HOJE no fuso de negócio
 * (America/Sao_Paulo), nunca o do servidor. O parser usa esse ano para completar
 * lançamentos "dd/mm" sem ano; em 31/12 ~22h de SP a Vercel em UTC já virou o ano
 * seguinte, e o extrato de dezembro ganharia o ano errado (CLAUDE.md: a data no
 * cliente sai do fuso de negócio, não de new Date() local). Pura e exportada para
 * ser testável sem File nem pdfjs.
 */
export function anoReferenciaPdf(agora: Date = new Date()): number {
  return Number(
    new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" })
      .format(agora)
      .slice(0, 4),
  );
}

// Bancos BR exportam CSV/OFX em Windows-1252 (superset do ISO-8859-1) tão
// often quanto em UTF-8. Tenta UTF-8 estrito (fatal): se os bytes não forem
// UTF-8 válido, decai para windows-1252 — que decodifica acentos (ê, ç, ã…) e
// os caracteres 0x80-0x9F (–, …, aspas curvas) sem virar "�".
export async function lerTexto(arquivo: File): Promise<string> {
  const bruto = await arquivo.arrayBuffer();
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bruto);
  } catch {
    return new TextDecoder("windows-1252").decode(bruto);
  }
}

/**
 * sha256 do arquivo CRU (bytes, não do texto decodificado): reenviar o mesmo
 * arquivo é identificado antes de qualquer parse. Hash sobre o texto decairia
 * junto com a heurística de encoding — dois decodes diferentes do mesmo byte
 * dariam hashes diferentes.
 *
 * `crypto.subtle` exige secure context (https ou localhost). Fora dele
 * devolvemos null e o servidor simplesmente não faz o short-circuit — a dedup
 * por linha da 0020/0021 continua valendo.
 */
export async function sha256DoArquivo(arquivo: File): Promise<string | null> {
  if (!globalThis.crypto?.subtle) return null;
  try {
    const buf = await crypto.subtle.digest("SHA-256", await arquivo.arrayBuffer());
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
  } catch {
    return null;
  }
}

/** Uma célula do exceljs em texto — Date, richText e fórmula têm forma própria. */
export function celulaParaTexto(v: unknown): string {
  if (v == null) return "";
  if (v instanceof Date) {
    const dd = String(v.getUTCDate()).padStart(2, "0");
    const mm = String(v.getUTCMonth() + 1).padStart(2, "0");
    return `${dd}/${mm}/${v.getUTCFullYear()}`;
  }
  if (typeof v === "object" && "richText" in v) {
    const { richText } = v as { richText: { text: string }[] };
    return richText.map((t) => t.text).join("");
  }
  if (typeof v === "object" && "result" in v) {
    const { result } = v as { result: unknown };
    return result == null ? "" : String(result);
  }
  return String(v);
}

// XLSX -> matriz de strings (1ª aba). exceljs entra por import dinâmico:
// só quem importa planilha paga o peso do bundle.
export async function matrizDoXlsx(arquivo: File): Promise<string[][]> {
  const { Workbook } = await import("exceljs");
  const wb = new Workbook();
  await wb.xlsx.load(await arquivo.arrayBuffer());
  const aba = wb.worksheets[0];
  if (!aba) return [];
  const matriz: string[][] = [];
  aba.eachRow((linha) => {
    const campos: string[] = [];
    linha.eachCell({ includeEmpty: true }, (celula) => {
      campos.push(celulaParaTexto(celula.value));
    });
    matriz.push(campos);
  });
  return matriz;
}

/** Os pedaços de uma página agrupados pela coordenada Y, do topo para a base. */
export function linhasDaPagina(itens: readonly unknown[]): string[] {
  const porY = new Map<number, { x: number; texto: string }[]>();
  for (const item of itens) {
    if (!item || typeof item !== "object" || !("str" in item)) continue;
    const { str, transform } = item as { str: string; transform: number[] };
    if (str.trim() === "") continue;
    const y = Math.round(transform[5]);
    const grupo = porY.get(y) ?? [];
    grupo.push({ x: transform[4], texto: str });
    porY.set(y, grupo);
  }
  const ys = [...porY.keys()].sort((a, b) => b - a); // topo -> base
  return ys.map((y) =>
    porY
      .get(y)!
      .sort((a, b) => a.x - b.x)
      .map((s) => s.texto)
      .join(" "),
  );
}

// PDF -> linhas de texto (pdfjs-dist, import dinâmico). Agrupa os pedaços
// pela coordenada Y para reconstruir as linhas visuais do extrato.
export async function linhasDoPdf(arquivo: File): Promise<string[]> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.min.mjs",
    import.meta.url,
  ).toString();
  const doc = await pdfjs.getDocument({ data: await arquivo.arrayBuffer() }).promise;
  const linhas: string[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const pagina = await doc.getPage(p);
    const conteudo = await pagina.getTextContent();
    linhas.push(...linhasDaPagina(conteudo.items));
  }
  return linhas;
}

/**
 * Lê o arquivo com o parser da origem. O preset de banco só é consultado no
 * caminho CSV — os outros formatos carregam a própria estrutura.
 */
export async function lerArquivoImportacao(
  arquivo: File,
  origem: OrigemImportacao,
  preset: PresetBanco,
): Promise<ResultadoParse> {
  if (origem === "OFX" || origem === "OFC") {
    return parseOfxExtrato(await lerTexto(arquivo));
  }
  if (origem === "XLSX") {
    return parseMatrizExtrato(await matrizDoXlsx(arquivo));
  }
  if (origem === "PDF") {
    return parsePdfExtrato(await linhasDoPdf(arquivo), anoReferenciaPdf());
  }
  return parseCsvExtrato(await lerTexto(arquivo), preset);
}
