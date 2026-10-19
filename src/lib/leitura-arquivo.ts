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
import { analisarLinhaFatura, parsePdfFatura } from "./importacao-fatura.ts";
import {validarOcrPdf,reconhecerPagina,type OpcoesOcr} from './ocr-financeiro.ts';
import {prepararXlsxSeguro} from './xlsx-seguro.ts';

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
  if (arquivo.size > 10485760) throw new Error("Arquivo acima do limite de 10 MB.");
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
  if(arquivo.size>10485760)throw new Error('Arquivo acima do limite de 10 MB.');
  const seguro=await prepararXlsxSeguro(new Uint8Array(await arquivo.arrayBuffer()));
  const excel = await import("exceljs");
  const Workbook = excel.Workbook ?? excel.default.Workbook;
  const wb = new Workbook();
  // Layout e validações do Excel não são necessários para importar valores.
  const opcoes={ignoreNodes:['mergeCells','cols','conditionalFormatting','dataValidations','extLst'],maxRows:10000,maxCols:256};
  await wb.xlsx.load(seguro.buffer as ArrayBuffer,opcoes);
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
export function linhasDaPagina(itens: readonly unknown[], separarTabelas = false): string[] {
  if (separarTabelas) {
    // A borda vem dos cabeçalhos das tabelas, nunca do meio da folha:
    // faturas podem ter margens assimétricas e colunas de larguras diferentes.
    const inicios = [...new Set(itens.flatMap(item => {
      if (!item || typeof item !== 'object' || !('str' in item) || !('transform' in item)) return [];
      const i = item as {str:string;transform:number[]};
      return /^DATA(?:\s|$)/.test(i.str.trim()) ? [Math.round(i.transform[4])] : [];
    }))].sort((a,b)=>a-b);
    const colunas = inicios.filter((x,i)=>i===0 || x-inicios[i-1]>80);
    if (colunas.length>2) throw new Error('PDF com tabelas ambíguas. Use outro arquivo ou revise o layout antes de importar.');
    if (colunas.length===2) {
      const borda=colunas[1]-8;
      const x=(item:unknown)=>item && typeof item==='object' && 'transform' in item ? (item as {transform:number[]}).transform[4] : 0;
      return [...linhasDaPagina(itens.filter(i=>x(i)<borda)),...linhasDaPagina(itens.filter(i=>x(i)>=borda))];
    }
  }
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
export async function linhasDoPdf(arquivo: File, fatura = false,opcoes:OpcoesOcr={}): Promise<string[]> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.min.mjs",
    import.meta.url,
  ).toString();
  const carregamento = pdfjs.getDocument({ data: await arquivo.arrayBuffer() });
  const doc = await carregamento.promise;
  const linhas: string[] = [];
  try {
  if(opcoes.ocr)validarOcrPdf(doc.numPages,arquivo.size);
  if(doc.numPages>100)throw new Error('PDF acima de 100 páginas. Divida o arquivo.');
  for (let p = 1; p <= doc.numPages; p++) {
    opcoes.sinal?.throwIfAborted();
    if(fatura) linhas.push('[[PAGINA]]');
    const pagina = await doc.getPage(p);
    const conteudo = await pagina.getTextContent();
    const texto=linhasDaPagina(conteudo.items,fatura);
    if(texto.join('').trim().length<20) {
     if(!opcoes.ocr)throw new Error('PDF digitalizado ou sem texto. Marque “Ler PDF digitalizado com OCR” e tente novamente.');
     opcoes.progresso?.(`Lendo página ${p} de ${doc.numPages} no navegador…`);
     const viewport=pagina.getViewport({scale:2});
     if(viewport.width*viewport.height>8_000_000)throw new Error('Página muito grande para OCR. Reduza a resolução.');
     const canvas=document.createElement('canvas');canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);
     try{await pagina.render({canvas,viewport}).promise;const itens=await reconhecerPagina(canvas,opcoes);linhas.push(...linhasDaPagina(itens,fatura));}
     finally{canvas.width=0;canvas.height=0;}
    }else linhas.push(...texto);
    pagina.cleanup();
  }
  return linhas;
  } finally { await carregamento.destroy(); }
}

/**
 * Lê o arquivo com o parser da origem. O preset de banco só é consultado no
 * caminho CSV — os outros formatos carregam a própria estrutura.
 */
export async function lerArquivoImportacao(
  arquivo: File,
  origem: OrigemImportacao,
  preset: PresetBanco,
  opcoes:OpcoesOcr={},
): Promise<ResultadoParse> {
  if (origem === "OFX" || origem === "OFC") {
    return parseOfxExtrato(await lerTexto(arquivo));
  }
  if (origem === "XLSX") {
    return parseMatrizExtrato(await matrizDoXlsx(arquivo));
  }
  if (origem === "PDF") {
    return parsePdfExtrato(await linhasDoPdf(arquivo,false,opcoes), anoReferenciaPdf());
  }
  return parseCsvExtrato(await lerTexto(arquivo), preset);
}

/** Decoders compartilhados; o contexto de fatura determina o significado do sinal. */
export async function lerArquivoFatura(arquivo: File, origem: OrigemImportacao, competencia: string,opcoes:OpcoesOcr={}) {
  if (origem === 'PDF') return parsePdfFatura(await linhasDoPdf(arquivo,true,opcoes), competencia);
  const resultado = origem==='CSV' ? parseCsvExtrato(await lerTexto(arquivo),'itau',true)
    : origem==='XLSX' ? parseMatrizExtrato(await matrizDoXlsx(arquivo),true)
    : await lerArquivoImportacao(arquivo, origem, 'itau');
  const linhas = resultado.linhas.map(l => {
    const linha = analisarLinhaFatura(l);
    // OFX padroniza crédito como positivo; CSV/XLSX de cartão podem trazer compras positivas.
    if ((origem==='OFX'||origem==='OFC') && l.valor>0 && linha.tipo!=='INFORMATIVO') {
      linha.tipo='AJUSTE'; linha.motivo='Crédito no OFX: confira e exclua o ajuste antes de importar compras.';
    }
    return linha;
  });
  if (!linhas.length) throw new Error(`Nenhum lançamento reconhecido no ${origem}. Confira o layout.`);
  return {linhas,descartadas:resultado.descartadas,total_informado:null as number|null};
}
