// Heurística de extrato em PDF — lógica pura, testada em
// tests/unit/pdf-extrato.test.ts. O PDF não tem estrutura tabular: o
// componente extrai o TEXTO por linha (pdfjs-dist) e aqui cada linha vira
// lançamento se tiver data + valor monetário. É melhor-esforço de
// verdade: o resultado SEMPRE passa pela tela de revisão do staging
// (0009) antes de tocar o histórico — nada entra sem o usuário conferir.
//
// Sinal: extrato em PDF raramente traz "-". Regra explícita:
//  * sufixo/prefixo "C" (crédito) na cédula do valor => receita (+);
//  * sufixo "D", sinal "-" ou valor entre parênteses => despesa (-);
//  * sem marcador => DESPESA. A revisão mostra o sinal antes de importar.

import { normalizarData, type LinhaImportacao, type ResultadoParse } from "./csv.ts";
import { paraCentavosAssinado } from "./money.ts";

const RE_DATA_TOKEN = /\b(\d{2}[/-]\d{2}[/-]\d{4}|\d{4}-\d{2}-\d{2}|\d{2}\/\d{2})\b/;
// "1.234,56", "1234,56", "R$ 89,90", "(89,90)", "89,90-", "89,90 D", "89,90 C"
const RE_VALOR_TOKEN =
  /\(?-?\s?(?:R\$\s?)?\d{1,3}(?:\.\d{3})*,\d{2}\)?(?:\s?[DCdc])?(?=\s|$)|-?\d+,\d{2}(?:\s?[DCdc])?(?=\s|$)/g;

/** Completa "dd/mm" com o ano de referência (extratos omitem o ano). */
function dataDaLinha(token: string, anoReferencia: number): string | null {
  if (/^\d{2}\/\d{2}$/.test(token)) {
    return normalizarData(`${token}/${anoReferencia}`);
  }
  return normalizarData(token);
}

function valorDaLinha(token: string): number | null {
  const t = token.trim();
  const credito = /[Cc]$/.test(t);
  // Magnitude via parser único (money.ts); o sinal aqui vem do marcador C/D,
  // não do texto do valor — por isso passamos só os dígitos/separadores.
  const magnitude = paraCentavosAssinado(t.replace(/[^\d,.]/g, ""));
  if (magnitude === null) return null;
  const centavos = Math.abs(magnitude);
  // Só "C" vira receita; "-", "D", parênteses e ausência de marcador caem
  // todos no default despesa (regra do cabeçalho do arquivo).
  return credito ? centavos : -centavos;
}

/**
 * Linhas de texto do PDF -> lançamentos. `descartadas` conta apenas linhas
 * que TÊM data mas não fecharam (valor/descrição faltando) — cabeçalho,
 * rodapé e saldo sem data são ruído esperado, não erro.
 */
export function parsePdfExtrato(
  linhasTexto: string[],
  anoReferencia: number,
): ResultadoParse {
  const linhas: LinhaImportacao[] = [];
  let descartadas = 0;
  for (const bruta of linhasTexto) {
    const linha = bruta.trim().replace(/\s{2,}/g, " ");
    const mData = linha.match(RE_DATA_TOKEN);
    if (!mData) continue; // ruído esperado (cabeçalho/rodapé), não conta
    const data = dataDaLinha(mData[1], anoReferencia);
    // Linhas de saldo não são lançamento.
    if (!data || /\bsaldo\b/i.test(linha)) {
      descartadas++;
      continue;
    }
    const valores = [...linha.matchAll(RE_VALOR_TOKEN)];
    if (valores.length === 0) {
      descartadas++;
      continue;
    }
    // Último valor da linha = valor do lançamento (o 1º pode ser documento).
    const tokenValor = valores[valores.length - 1][0];
    const valor = valorDaLinha(tokenValor);
    const descricao = linha
      .replace(mData[1], "")
      .replace(tokenValor, "")
      .replace(/\s{2,}/g, " ")
      .trim();
    if (valor === null || descricao === "") {
      descartadas++;
      continue;
    }
    linhas.push({ data, valor, descricao });
  }
  return { linhas, descartadas };
}
