// Parse de extrato CSV na borda da UI — lógica pura, testada em
// tests/unit/csv.test.ts. Saída: linhas em CENTAVOS com sinal
// (negativo = despesa), prontas para a RPC criar_importacao (0009).
// Presets cobrem os CSVs padrão dos bancos; "generico" tenta detectar
// colunas pelo cabeçalho.

export type LinhaImportacao = {
  data: string; // ISO "YYYY-MM-DD"
  valor: number; // centavos, com sinal
  descricao: string;
};

export type PresetBanco = "nubank" | "inter" | "generico";

export const PRESETS: { id: PresetBanco; rotulo: string }[] = [
  { id: "nubank", rotulo: "Nubank (conta)" },
  { id: "inter", rotulo: "Banco Inter" },
  { id: "generico", rotulo: "Genérico (detectar colunas)" },
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

/** Detecta separador pela 1ª linha: o que produzir mais colunas vence. */
export function detectarSeparador(primeiraLinha: string): string {
  const candidatos = [",", ";", "\t"];
  let melhor = ",";
  let max = 0;
  for (const sep of candidatos) {
    const n = splitCsvLinha(primeiraLinha, sep).length;
    if (n > max) {
      max = n;
      melhor = sep;
    }
  }
  return melhor;
}

/** "31/07/2026", "2026-07-31" ou "31-07-2026" -> ISO; null se inválida. */
export function normalizarData(bruta: string): string | null {
  const s = bruta.trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{2})[/-](\d{2})[/-](\d{4})/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  return null;
}

/** "1.234,56", "-1234.56", "R$ 10,00" -> centavos com sinal; null inválido. */
export function valorParaCentavosAssinado(bruto: string): number | null {
  let s = bruto.replace(/[R$\s"]/g, "");
  if (!s) return null;
  let sinal = 1;
  if (s.startsWith("-")) {
    sinal = -1;
    s = s.slice(1);
  } else if (s.startsWith("+")) {
    s = s.slice(1);
  }
  if (s.includes(",")) {
    s = s.replace(/\./g, "").replace(",", ".");
  } else {
    const partes = s.split(".");
    if (partes.length > 2 || (partes.length === 2 && partes[1].length === 3)) {
      s = partes.join("");
    }
  }
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  const centavos = Math.round(n * 100) * sinal;
  return centavos === 0 ? null : centavos;
}

function indiceColuna(cabecalho: string[], nomes: string[]): number {
  const lower = cabecalho.map((c) => c.toLowerCase());
  for (const nome of nomes) {
    const i = lower.findIndex((c) => c.includes(nome));
    if (i >= 0) return i;
  }
  return -1;
}

export type ResultadoParse = {
  linhas: LinhaImportacao[];
  descartadas: number; // linhas não parseáveis (fora o cabeçalho)
};

/**
 * Parse completo do arquivo. Presets:
 *  - nubank: Data,Valor,Identificador,Descrição (valor já com sinal)
 *  - inter: separador ;, colunas Data;Descrição/Histórico;Valor
 *  - generico: detecta colunas data/descrição/valor pelo cabeçalho
 */
export function parseCsvExtrato(
  conteudo: string,
  preset: PresetBanco
): ResultadoParse {
  const linhasBrutas = conteudo
    .replace(/^﻿/, "") // BOM
    .split(/\r?\n/)
    .filter((l) => l.trim() !== "");
  if (linhasBrutas.length < 2) return { linhas: [], descartadas: 0 };

  const sep = preset === "inter" ? ";" : detectarSeparador(linhasBrutas[0]);
  const cabecalho = splitCsvLinha(linhasBrutas[0], sep);

  let iData: number;
  let iValor: number;
  let iDesc: number;
  if (preset === "nubank") {
    iData = 0;
    iValor = 1;
    iDesc = 3 < cabecalho.length ? 3 : cabecalho.length - 1;
  } else {
    iData = indiceColuna(cabecalho, ["data", "date"]);
    iValor = indiceColuna(cabecalho, ["valor", "value", "amount", "montante"]);
    iDesc = indiceColuna(cabecalho, [
      "descri", "histórico", "historico", "lançamento", "lancamento", "title", "estabelecimento",
    ]);
    if (iData < 0 || iValor < 0 || iDesc < 0) {
      return { linhas: [], descartadas: linhasBrutas.length - 1 };
    }
  }

  const linhas: LinhaImportacao[] = [];
  let descartadas = 0;
  for (const bruta of linhasBrutas.slice(1)) {
    const campos = splitCsvLinha(bruta, sep);
    const data = normalizarData(campos[iData] ?? "");
    const valor = valorParaCentavosAssinado(campos[iValor] ?? "");
    const descricao = (campos[iDesc] ?? "").trim();
    if (!data || valor === null || descricao === "") {
      descartadas++;
      continue;
    }
    linhas.push({ data, valor, descricao });
  }
  return { linhas, descartadas };
}
