import { readdirSync, readFileSync } from "node:fs";

// Base compartilhada dos gates estáticos de `supabase/migrations/`.
//
// Existe porque três invariantes que o CLAUDE.md deste projeto chama de
// obrigatórios — `security_invoker = true` em view, `set search_path` em função
// SECURITY DEFINER, e revoke/grant só sobre função que alguma migração cria —
// hoje são prosa. Prosa não quebra o CI.
//
// Analisar SQL com regex direto no texto bruto é armadilha: o corpo de uma
// função é uma string dollar-quoted que contém SQL de mentira, e comentário
// contém SQL de exemplo. `limparSql` apaga os dois antes de qualquer gate
// olhar, para que "create view" dentro de um comentário não conte como view.

const DIR_MIGRACOES = new URL("../../supabase/migrations/", import.meta.url);

export interface Migracao {
  /** Prefixo numérico do arquivo — é a ordem de aplicação. */
  numero: number;
  arquivo: string;
  /** SQL sem comentário, sem corpo dollar-quoted e sem conteúdo de string. */
  sql: string;
  bruto: string;
}

/**
 * Reconhece o delimitador dollar-quoted que começa em `i`: `$$` ou `$tag$`.
 * Retorna o delimitador inteiro, ou null. `$1` não é delimitador — tag de
 * Postgres nunca começa com dígito, e é assim que parâmetro posicional
 * escapa desta função.
 */
function delimitadorDollar(sql: string, i: number): string | null {
  if (sql[i] !== "$") return null;
  const fim = sql.indexOf("$", i + 1);
  if (fim === -1) return null;
  const tag = sql.slice(i + 1, fim);
  if (tag !== "" && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(tag)) return null;
  return sql.slice(i, fim + 1);
}

/**
 * Apaga comentário de linha, comentário de bloco (que aninha no Postgres),
 * conteúdo de string simples e corpo dollar-quoted — substituindo por espaço,
 * preservando as quebras de linha.
 *
 * Preserva o comprimento e a contagem de linhas de propósito: o número de linha
 * de um achado continua batendo com o arquivo real, que é o que torna a
 * mensagem de falha acionável.
 *
 * Os delimitadores `$$` ficam. Só o miolo some — o gate de search_path precisa
 * enxergar onde o corpo começa para saber onde os atributos terminam.
 */
export function limparSql(sql: string): string {
  const saida: string[] = [];
  const branco = (c: string) => (c === "\n" ? "\n" : " ");
  let i = 0;

  while (i < sql.length) {
    if (sql.startsWith("--", i)) {
      while (i < sql.length && sql[i] !== "\n") {
        saida.push(" ");
        i++;
      }
      continue;
    }

    if (sql.startsWith("/*", i)) {
      let nivel = 0;
      while (i < sql.length) {
        if (sql.startsWith("/*", i)) {
          nivel++;
          saida.push("  ");
          i += 2;
          continue;
        }
        if (sql.startsWith("*/", i)) {
          nivel--;
          saida.push("  ");
          i += 2;
          if (nivel === 0) break;
          continue;
        }
        saida.push(branco(sql[i]));
        i++;
      }
      continue;
    }

    if (sql[i] === "'") {
      saida.push("'");
      i++;
      while (i < sql.length) {
        // '' é aspa escapada, não fim de string.
        if (sql[i] === "'" && sql[i + 1] === "'") {
          saida.push("  ");
          i += 2;
          continue;
        }
        if (sql[i] === "'") {
          saida.push("'");
          i++;
          break;
        }
        saida.push(branco(sql[i]));
        i++;
      }
      continue;
    }

    const delim = delimitadorDollar(sql, i);
    if (delim !== null) {
      saida.push(delim);
      i += delim.length;
      const fim = sql.indexOf(delim, i);
      const corpo = fim === -1 ? sql.slice(i) : sql.slice(i, fim);
      for (const c of corpo) saida.push(branco(c));
      i += corpo.length;
      if (fim !== -1) {
        saida.push(delim);
        i += delim.length;
      }
      continue;
    }

    saida.push(sql[i]);
    i++;
  }

  return saida.join("");
}

/** Migrações em ordem de aplicação, que é a ordem numérica do prefixo. */
export function lerMigracoes(): Migracao[] {
  const arquivos = readdirSync(DIR_MIGRACOES)
    .filter((nome) => nome.endsWith(".sql"))
    .sort();

  return arquivos.map((arquivo) => {
    // Prefixo antes do primeiro "_": 0001..0027 ou timestamp 20260909205952.
    const numero = Number(arquivo.split("_")[0]);
    if (!Number.isInteger(numero)) {
      throw new Error(
        `migração "${arquivo}" não começa com prefixo numérico — ` +
          `a ordem de aplicação depende dele.`,
      );
    }
    const bruto = readFileSync(new URL(arquivo, DIR_MIGRACOES), "utf8");
    return { numero, arquivo, sql: limparSql(bruto), bruto };
  });
}

/** Linha (1-indexada) de um offset, para a mensagem de falha apontar o lugar. */
export function linhaDe(sql: string, offset: number): number {
  let linha = 1;
  for (let i = 0; i < offset && i < sql.length; i++) {
    if (sql[i] === "\n") linha++;
  }
  return linha;
}

/** `public.foo` e `"public"."foo"` viram a mesma chave. */
export function normalizarNome(nome: string): string {
  return nome
    .split(".")
    .map((parte) => parte.replace(/"/g, "").trim().toLowerCase())
    .filter((parte) => parte !== "")
    .join(".");
}
