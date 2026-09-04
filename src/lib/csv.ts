// Parse de extrato CSV/planilha na borda da UI — lógica pura, testada em
// tests/unit/csv.test.ts. Saída: linhas em CENTAVOS com sinal
// (negativo = despesa), prontas para a RPC criar_importacao (0009).
//
// Detecção robusta por CABEÇALHO (não por posição fixa), cobrindo os 3
// layouts de banco brasileiro:
//   (A) coluna única "Valor" já com sinal            — Nubank, Inter, Itaú, BB
//   (B) colunas separadas "Débito" e "Crédito"       — Bradesco, Caixa
//   (C) coluna "Valor" + coluna "D/C" (natureza)     — variações
// Ainda pula linhas de preâmbulo (metadados de conta antes do cabeçalho, comum
// em Itaú/Bradesco/Caixa). Para máxima confiabilidade em QUALQUER banco, o OFX/
// OFC continua sendo o caminho recomendado (sinal padronizado em <TRNAMT>).

import { paraCentavosAssinado } from "./money.ts";
import { LIMITE_BYTES_IMPORTACAO, LIMITE_LINHAS_IMPORTACAO } from "./constantes.ts";

export type LinhaImportacao = {
  data: string; // ISO "YYYY-MM-DD"
  valor: number; // centavos, com sinal
  descricao: string;
  /**
   * Identificador do provedor quando o formato traz um (FITID do OFX/OFC,
   * id da Pluggy). Tem precedência sobre o fingerprint na dedup do servidor:
   * é o banco afirmando "esta é a mesma transação", não uma heurística nossa.
   * CSV, XLSX e PDF não têm — ficam com o fingerprint de 0020.
   */
  id_externo?: string;
};

export type PresetBanco =
  | "nubank"
  | "inter"
  | "itau"
  | "bradesco"
  | "caixa"
  | "bb"
  | "generico";

// O preset hoje só dá uma dica de separador; a detecção de colunas é automática
// por cabeçalho, então funciona mesmo se o banco mudar a ordem das colunas.
export const PRESETS: { id: PresetBanco; rotulo: string }[] = [
  { id: "nubank", rotulo: "Nubank" },
  { id: "inter", rotulo: "Banco Inter" },
  { id: "itau", rotulo: "Itaú" },
  { id: "bradesco", rotulo: "Bradesco" },
  { id: "caixa", rotulo: "Caixa" },
  { id: "bb", rotulo: "Banco do Brasil" },
  { id: "generico", rotulo: "Genérico / outro banco (detectar colunas)" },
];

/** Split de linha CSV respeitando aspas (campo com vírgula/; interno). */
export function splitCsvLinha(linha: string, sep: string): string[] {
  const campos: string[] = [];
  let atual = "";
  let dentroAspas = false;
  for (let i = 0; i < linha.length; i++) {
    const ch = linha[i];
    if (ch === '"') {
      if (dentroAspas && linha[i + 1] === '"') {
        atual += '"';
        i++;
      } else {
        dentroAspas = !dentroAspas;
      }
    } else if (ch === sep && !dentroAspas) {
      campos.push(atual);
      atual = "";
    } else {
      atual += ch;
    }
  }
  campos.push(atual);
  return campos.map((c) => c.trim());
}

/** Separador dominante nas primeiras linhas (";" vence empate — padrão BR). */
export function detectarSeparador(entrada: string | string[]): string {
  const amostra = (Array.isArray(entrada) ? entrada : [entrada]).slice(0, 8);
  const candidatos = [";", ",", "\t"];
  let melhor = ";";
  let max = 0;
  for (const sep of candidatos) {
    const n = Math.max(0, ...amostra.map((l) => splitCsvLinha(l, sep).length));
    if (n > max) {
      max = n;
      melhor = sep;
    }
  }
  return melhor;
}

/** "31/07/2026", "2026-07-31", "31-07-2026" ou "31/07/26" -> ISO; null se inválida. */
export function normalizarData(bruta: string): string | null {
  const s = bruta.trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{2})[/-](\d{2})[/-](\d{4})/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  // Ano com 2 dígitos (ex.: Caixa "31/07/26"): assume 20xx.
  m = s.match(/^(\d{2})[/-](\d{2})[/-](\d{2})(?!\d)/);
  if (m) return `20${m[3]}-${m[2]}-${m[1]}`;
  return null;
}

/**
 * Conversão de valor -> centavos com sinal. Reexporta o parser único de
 * money.ts (fonte de verdade); mantido aqui como nome estável do contrato de
 * importação e para compatibilidade dos testes.
 */
export const valorParaCentavosAssinado = paraCentavosAssinado;

function indiceColuna(cabecalho: string[], nomes: string[]): number {
  const lower = cabecalho.map((c) => c.toLowerCase().trim());
  for (const nome of nomes) {
    const i = lower.findIndex((c) => c.includes(nome));
    if (i >= 0) return i;
  }
  return -1;
}

const NOMES_DATA = ["data", "date"];
const NOMES_DESC = [
  "descri", "histórico", "historico", "lançamento", "lancamento",
  "title", "estabelecimento", "memo", "detalhe", "movimenta",
];
const NOMES_VALOR = ["valor", "value", "amount", "montante"];
const NOMES_DEBITO = ["débito", "debito", "saída", "saida", "valor (-)", "valor(-)"];
const NOMES_CREDITO = ["crédito", "credito", "entrada", "valor (+)", "valor(+)"];
// Coluna de natureza explícita: apenas rótulos inequívocos (evita falso-positivo
// com uma coluna genérica "tipo" que signifique tipo de transação).
const NOMES_DC = ["d/c", "débito/crédito", "debito/credito", "deb/cred"];

type MapaColunas = {
  iData: number;
  iDesc: number;
  iValor: number; // coluna única com sinal (-1 se ausente)
  iDebito: number; // coluna de saída (-1 se ausente)
  iCredito: number; // coluna de entrada (-1 se ausente)
  iDC: number; // coluna de natureza D/C (-1 se ausente)
};

function mapearColunas(cabecalho: string[]): MapaColunas {
  const iDebito = indiceColuna(cabecalho, NOMES_DEBITO);
  const iCredito = indiceColuna(cabecalho, NOMES_CREDITO);
  const temParSeparado = iDebito >= 0 && iCredito >= 0;
  return {
    iData: indiceColuna(cabecalho, NOMES_DATA),
    iDesc: indiceColuna(cabecalho, NOMES_DESC),
    // Com débito+crédito separados, ignoramos a coluna única "Valor".
    iValor: temParSeparado ? -1 : indiceColuna(cabecalho, NOMES_VALOR),
    iDebito,
    iCredito,
    iDC: indiceColuna(cabecalho, NOMES_DC),
  };
}

function mapaValido(m: MapaColunas): boolean {
  const temValor = m.iValor >= 0 || (m.iDebito >= 0 && m.iCredito >= 0);
  return m.iData >= 0 && m.iDesc >= 0 && temValor;
}

/** Magnitude (>=0) de uma célula; 0 se vazia/zero/inválida. */
function magnitude(celula: string | undefined): number {
  const c = paraCentavosAssinado(celula ?? "");
  return c === null ? 0 : Math.abs(c);
}

/** (B) Colunas separadas: crédito = entrada (+), débito = saída (-). */
function valorPorParSeparado(campos: string[], m: MapaColunas): number | null {
  const cred = magnitude(campos[m.iCredito]);
  const deb = magnitude(campos[m.iDebito]);
  if (cred > 0 && deb === 0) return cred;
  if (deb > 0 && cred === 0) return -deb;
  if (cred > 0 && deb > 0) return cred - deb; // raro; usa o líquido
  return null; // ambas vazias -> linha sem valor
}

/**
 * Sinal de um rótulo de natureza: -1 débito, +1 crédito, null se não for
 * reconhecível. Serve tanto ao sufixo da célula ("12,50 D") quanto à coluna
 * D/C dedicada — os dois dizem a mesma coisa, em lugares diferentes.
 */
function sinalDeRotulo(rotulo: string): -1 | 1 | null {
  const t = rotulo.trim().toUpperCase();
  if (t.startsWith("D") || t.includes("SAÍDA") || t.includes("SAIDA")) return -1;
  if (t.startsWith("C") || t.includes("ENTRADA")) return 1;
  return null;
}

/** Separa o sufixo D/C da célula de valor ("12,50 D") — comum na Caixa. */
function separarSufixoDC(cru: string): { numero: string; sinal: -1 | 1 | null } {
  const sufixo = /\s([DCdc])$/.exec(cru);
  if (!sufixo) return { numero: cru, sinal: null };
  return { numero: cru.slice(0, sufixo.index), sinal: sinalDeRotulo(sufixo[1]) };
}

/** Deriva o valor COM SINAL de uma linha, conforme o layout detectado. */
function valorDaLinha(campos: string[], m: MapaColunas): number | null {
  if (m.iDebito >= 0 && m.iCredito >= 0) return valorPorParSeparado(campos, m);
  if (m.iValor < 0) return null;

  const { numero, sinal: sinalSufixo } = separarSufixoDC((campos[m.iValor] ?? "").trim());
  const bruto = paraCentavosAssinado(numero);
  if (bruto === null) return null;

  // Precedência: sufixo na própria célula, depois (C) a coluna D/C dedicada.
  const sinal = sinalSufixo ?? (m.iDC >= 0 ? sinalDeRotulo(campos[m.iDC] ?? "") : null);
  // (A) Sem rótulo nenhum, a coluna única já traz o sinal.
  return sinal === null ? bruto : sinal * Math.abs(bruto);
}

/** Acha a linha de cabeçalho (pula preâmbulo de metadados) e mapeia colunas. */
function localizarCabecalho(
  linhas: string[][],
): { idx: number; mapa: MapaColunas } | null {
  const limite = Math.min(linhas.length, 25);
  for (let i = 0; i < limite; i++) {
    const mapa = mapearColunas(linhas[i]);
    if (mapaValido(mapa)) return { idx: i, mapa };
  }
  return null;
}

export type ResultadoParse = {
  linhas: LinhaImportacao[];
  descartadas: number; // linhas não parseáveis (fora o cabeçalho)
};

function extrairLinhas(
  matriz: string[][],
  idxCabecalho: number,
  mapa: MapaColunas,
): ResultadoParse {
  const linhas: LinhaImportacao[] = [];
  let descartadas = 0;
  for (const campos of matriz.slice(idxCabecalho + 1)) {
    const data = normalizarData(campos[mapa.iData] ?? "");
    const valor = valorDaLinha(campos, mapa);
    const descricao = (campos[mapa.iDesc] ?? "").trim();
    if (!data || valor === null || valor === 0 || descricao === "") {
      // Linha totalmente vazia não conta como descartada (rodapé/saldo).
      if (campos.some((c) => c.trim() !== "")) descartadas++;
      continue;
    }
    linhas.push({ data, valor, descricao });
  }
  return { linhas, descartadas };
}

/**
 * Parse de extrato CSV. `preset` só sugere o separador (Inter/Bradesco/Caixa/BB
 * usam ";"); as colunas são detectadas pelo cabeçalho, então a ordem pode
 * variar. Layouts suportados: valor único com sinal, débito/crédito separados,
 * e valor + coluna D/C.
 */
export function parseCsvExtrato(
  conteudo: string,
  preset: PresetBanco,
): ResultadoParse {
  const linhasBrutas = conteudo
    .replace(/^﻿/, "") // BOM
    .split(/\r?\n/)
    .filter((l) => l.trim() !== "");
  if (linhasBrutas.length < 2) return { linhas: [], descartadas: 0 };

  const presetsPontoVirgula: PresetBanco[] = ["inter", "bradesco", "caixa", "bb"];
  const sep = presetsPontoVirgula.includes(preset)
    ? ";"
    : detectarSeparador(linhasBrutas);
  const matriz = linhasBrutas.map((l) => splitCsvLinha(l, sep));

  const cab = localizarCabecalho(matriz);
  if (!cab) return { linhas: [], descartadas: linhasBrutas.length - 1 };
  return extrairLinhas(matriz, cab.idx, cab.mapa);
}

/**
 * Planilha (XLSX já convertida em matriz de strings pelo componente, via
 * exceljs) -> lançamentos. Mesma detecção robusta do CSV: acha o cabeçalho
 * (pulando preâmbulo) e mapeia colunas por nome.
 */
export function parseMatrizExtrato(matriz: string[][]): ResultadoParse {
  const naoVazias = matriz.filter((l) => l.some((c) => c.trim() !== ""));
  if (naoVazias.length < 2) return { linhas: [], descartadas: 0 };
  const cab = localizarCabecalho(naoVazias);
  if (!cab) return { linhas: [], descartadas: naoVazias.length - 1 };
  return extrairLinhas(naoVazias, cab.idx, cab.mapa);
}

/**
 * Erro se o total de linhas parseadas estourar o teto que a RPC
 * criar_importacao aceita; null quando dentro do limite. Chamada antes de
 * enviar o staging pra não gastar uma viagem ao servidor com um payload que
 * vai ser rejeitado — e pra não tentar processar centenas de milhares de
 * linhas de uma vez no cliente (T-04).
 */
export function validarTetoLinhasImportacao(totalLinhas: number): string | null {
  if (totalLinhas > LIMITE_LINHAS_IMPORTACAO) {
    return `O arquivo tem ${totalLinhas} linhas reconhecidas; o teto por importação é ${LIMITE_LINHAS_IMPORTACAO}. Divida o arquivo em partes menores.`;
  }
  return null;
}

/**
 * Erro se o arquivo escolhido estourar o teto de tamanho aceito na
 * importação; null quando dentro do limite. Checagem prévia, antes de ler o
 * conteúdo do arquivo (T-04).
 */
export function validarTamanhoArquivoImportacao(tamanhoBytes: number): string | null {
  if (tamanhoBytes > LIMITE_BYTES_IMPORTACAO) {
    const mb = (tamanhoBytes / (1024 * 1024)).toFixed(1);
    const tetoMb = (LIMITE_BYTES_IMPORTACAO / (1024 * 1024)).toFixed(0);
    return `O arquivo tem ${mb} MB; o teto por importação é ${tetoMb} MB.`;
  }
  return null;
}
