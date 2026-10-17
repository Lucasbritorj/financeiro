import { centavosParaDecimalEditavel } from "./money.ts";

export type TransacaoExportacao = {
  id: string; descricao: string; valor_total: number; data_compra: string;
  tipo: string; forma_pagamento: string; natureza: string | null;
  categorias: { nome: string } | null;
};

function textoSeguro(valor: string): string {
  const seguro = /^[\s\u0000-\u001f]*[=+\-@]/.test(valor) ? `'${valor}` : valor;
  return `"${seguro.replaceAll('"', '""')}"`;
}

export function exportarCsv(linhas: readonly TransacaoExportacao[]): string {
  const cabecalho = ["ID", "Data", "Descrição", "Tipo", "Forma", "Categoria", "Natureza", "Valor (R$)"].join(";");
  const registros = linhas.map((t) => {
    if (!Number.isSafeInteger(t.valor_total)) throw new Error("Valor inválido em centavos.");
    const texto = [t.id, t.data_compra, t.descricao, t.tipo, t.forma_pagamento, t.categorias?.nome ?? "", t.natureza ?? "CONSUMO"];
    return [...texto.map(textoSeguro), centavosParaDecimalEditavel(t.valor_total)].join(";");
  });
  return `\uFEFF${[cabecalho, ...registros].join("\r\n")}\r\n`;
}
