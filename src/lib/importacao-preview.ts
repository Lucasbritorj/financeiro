// Lógica pura do preview de importação — extraída de
// src/components/importador-csv.tsx para poder ser testada sem renderizar
// componente (Node 24 recusa .tsx: ver tests/unit/edicao-transacao.test.ts
// para o mesmo raciocínio no fluxo de edição).

export type LinhaRevisao = {
  id: string;
  data: string;
  valor: number;
  descricao: string;
  categoria_sugerida: string | null;
  duplicada: boolean;
  ignorar: boolean;
  /** 0020: NOVO grava; DUPLICADO nunca grava; AMBIGUO exige opt-in. */
  classificacao: "NOVO" | "DUPLICADO" | "AMBIGUO";
};

export type OrigemImportacao = "CSV" | "OFX" | "OFC" | "XLSX" | "PDF";

/** Extensões que usam o parser de OFX/OFC — mesma bifurcação de sempre. */
const EXTENSOES_OFX = new Set(["ofx", "ofc"]);

/**
 * Extensão do nome do arquivo, em minúsculas — "" quando não há ponto
 * (mesmo fallback de `arquivo.name.split(".").pop()?.toLowerCase() ?? ""`).
 */
export function extensaoDoArquivo(nomeArquivo: string): string {
  const partes = nomeArquivo.split(".");
  return partes.length > 1 ? (partes.pop() ?? "").toLowerCase() : "";
}

/**
 * Qual origem rotular o resultado — decide só o RÓTULO, não QUAL parser
 * chamar (isso continua no componente, porque cada parser tem assinatura e
 * efeitos colaterais diferentes: leitura de texto vs. matriz vs. páginas de
 * PDF). Extensão desconhecida cai em CSV, mesmo comportamento de hoje.
 */
export function origemPorExtensao(extensao: string): OrigemImportacao {
  if (EXTENSOES_OFX.has(extensao)) return extensao.toUpperCase() as OrigemImportacao;
  if (extensao === "xlsx") return "XLSX";
  if (extensao === "pdf") return "PDF";
  return "CSV";
}

export type ResumoRevisao = {
  /** Total de linhas na tela de revisão, incluindo as que não serão gravadas. */
  total: number;
  /** DUPLICADO nunca grava, mesmo desmarcado — a regra vive em confirmar_importacao (0020).
   *  Este contador espelha o servidor em vez de prometer algo que o banco vai recusar. */
  aImportar: number;
  novos: number;
  duplicadas: number;
  ambiguos: number;
};

export function calcularResumoRevisao(linhas: LinhaRevisao[]): ResumoRevisao {
  return {
    total: linhas.length,
    aImportar: linhas.filter((l) => !l.ignorar && l.classificacao !== "DUPLICADO").length,
    novos: linhas.filter((l) => l.classificacao === "NOVO").length,
    duplicadas: linhas.filter((l) => l.classificacao === "DUPLICADO").length,
    ambiguos: linhas.filter((l) => l.classificacao === "AMBIGUO").length,
  };
}
