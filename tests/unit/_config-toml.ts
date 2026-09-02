// Leitura mínima de supabase/config.toml, no mesmo espírito de _ci-yml.ts:
// não é um parser de TOML — entende só `[secao]` e `chave = valor` numa
// única linha (que é 100% do que este arquivo usa), e RECUSA o resto em
// voz alta.
//
// CONTRATO
//   Faz     — lê uma seção (`[auth]`, `[auth.email]`, `[auth.rate_limit]`)
//             e devolve suas chaves de topo como string, bool ou número.
//   Não faz — não entende array, string multi-linha, tabela inline `{}`,
//             nem comentário no fim da linha de valor.
//   Escopo  — consumido por tests/unit/supabase-auth-config.test.ts.
//   Vermelho— provado com TOML sintético em tests/unit/config-toml-parser.test.ts,
//             que exercita os cinco `falhar()` daqui. Antes esta linha dizia que a
//             prova estava "no teste que usa este módulo", e não estava: aquele
//             teste só lê o config.toml real e válido, então nenhum caminho de
//             recusa era executado.
//
// Mesma razão de _ci-yml.ts para não trazer dependência: node:fs basta para
// ler três chaves, e isso é o que permite o teste rodar no `npm test` sem
// instalar um parser de TOML.
import { readFileSync } from "node:fs";

const RAIZ = new URL("../../", import.meta.url);
const CAMINHO_CONFIG = new URL("supabase/config.toml", RAIZ);

export const ERRO = "config.toml ilegível:";

export type ValorToml = string | boolean | number | readonly string[];

function falhar(queixa: string): never {
  throw new Error(`${ERRO} ${queixa}`);
}

function converterValor(bruto: string): ValorToml {
  const v = bruto.trim();
  if (v === "true") return true;
  if (v === "false") return false;
  if (v.startsWith('"') && v.endsWith('"') && v.length >= 2) return v.slice(1, -1);
  if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
  if (v.startsWith("[") && v.endsWith("]")) {
    const dentro = v.slice(1, -1).trim();
    if (dentro === "") return [];
    return dentro.split(",").map((item) => {
      const s = item.trim();
      if (!s.startsWith('"') || !s.endsWith('"') || s.length < 2) {
        falhar(`array com item não-string: "${item}" em "${bruto}" (só array de strings entre aspas).`);
      }
      return s.slice(1, -1);
    });
  }
  falhar(`valor não reconhecido: "${bruto}" (só string entre aspas, número, true/false, array de strings).`);
}

/**
 * As chaves de topo de uma seção `[nome]`, até a próxima linha `[...]` ou o
 * fim do arquivo. Lança se a seção não existir.
 */
export function lerSecaoToml(
  toml: string,
  secao: string,
): Readonly<Record<string, ValorToml>> {
  const linhas = toml.split(/\r?\n/);
  const cabecalho = `[${secao}]`;

  const iSecao = linhas.findIndex((l) => l.trim() === cabecalho);
  if (iSecao < 0) falhar(`não achei a seção \`${cabecalho}\`.`);

  const valores: Record<string, ValorToml> = {};

  for (let i = iSecao + 1; i < linhas.length; i++) {
    const linha = linhas[i];
    const semComentario = linha.trim();
    if (semComentario === "") continue;
    if (semComentario.startsWith("#")) continue;
    if (/^\[.+\]$/.test(semComentario)) break; // proxima secao

    const corte = semComentario.indexOf("=");
    if (corte < 0) {
      falhar(`linha dentro de \`${cabecalho}\` não é \`chave = valor\`: "${semComentario}".`);
    }
    const chave = semComentario.slice(0, corte).trim();
    valores[chave] = converterValor(semComentario.slice(corte + 1));
  }

  if (Object.keys(valores).length === 0) {
    falhar(`a seção \`${cabecalho}\` existe mas não tem nenhuma chave — arquivo mudou de forma?`);
  }

  return valores;
}

/** O supabase/config.toml do repositório, cru. */
export function lerConfigToml(caminho: URL = CAMINHO_CONFIG): string {
  return readFileSync(caminho, "utf8");
}
