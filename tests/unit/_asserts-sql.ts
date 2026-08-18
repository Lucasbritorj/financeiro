// Base compartilhada dos gates estáticos da suíte SQL.
//
// CONTRATO
//   Faz     — lê supabase/tests/*.sql e tests/sql/00_shim_auth.sql, remove
//             comentário e expõe: semComentario, lerAsserts, dependeDoAmbiente,
//             noticesDeSucesso, lerShim.
//   Não faz — não executa SQL, não substitui tests/sql/run_asserts.sh e não
//             prova que um notice é ALCANÇADO em runtime. É análise de texto.
//   Escopo  — consumido pelos gates tests/unit/asserts-sql-*.test.ts e, de
//             `semComentario` só, por tests/gate/migracoes.ts. Uso fora de
//             tests/ é acidente, não contrato: não é API do app.
//             `semComentario` é a exceção deliberada: um segundo removedor de
//             comentário SQL neste repositório discordaria deste em silêncio,
//             que é o modo de falha declarado seis linhas abaixo.
//
// Os asserts de supabase/tests seguem dois contratos de setup incompatíveis e
// nada verifica o pareamento entre eles e tests/sql/00_shim_auth.sql. Cada gate
// precisaria ler os mesmos arquivos e decidir as mesmas coisas; três parsers
// independentes discordariam em silêncio, que é o modo de falha que estes
// gates existem para evitar. Então a leitura e a análise ficam aqui.
//
// Sem dependência externa: node:fs e node:url bastam, e é isso que permite
// rodar no `npm test` sem Docker — a suíte SQL de verdade exige Postgres.
import { readdirSync, readFileSync } from "node:fs";

const RAIZ = new URL("../../", import.meta.url);
const DIR_ASSERTS = new URL("supabase/tests/", RAIZ);
const CAMINHO_SHIM = new URL("tests/sql/00_shim_auth.sql", RAIZ);

export interface ArquivoSql {
  /** Nome do arquivo, para a mensagem de falha apontar o culpado. */
  readonly arquivo: string;
  /** Conteúdo cru, como está no disco. */
  readonly bruto: string;
  /** Conteúdo sem comentário. É sobre ele que toda regra decide. */
  readonly codigo: string;
}

export interface Shim {
  readonly criaAuthUsers: boolean;
  readonly temCreatedAt: boolean;
  readonly insereFixture: boolean;
}

/**
 * Remove comentário de linha (`--`) e de bloco, preservando o que está dentro
 * de literal SQL entre aspas simples.
 *
 * A ordem importa e é o ponto todo desta função: comentário é reconhecido
 * primeiro, então `-- não persiste` com apóstrofo solto não abre string falsa;
 * e string é reconhecida antes de comentário, então `'-- isto é dado'` não vira
 * comentário. Sem isso, o cabeçalho de verificacao_assistente.sql — que cita
 * `"OK: N/N asserts"` em comentário — passaria por notice de sucesso, e o gate
 * do notice ficaria verde sobre um arquivo que nunca emite nada.
 *
 * Delimitador dollar-quote (`$teste$`) é deixado passar de propósito: o corpo
 * dele é código PL/pgSQL, e `--` lá dentro é comentário de verdade. Tratá-lo
 * como string opaca esconderia exatamente o que se quer inspecionar.
 *
 * Limite declarado: string com escape de barra invertida (`e'...\'...'`) não é
 * tratada. Nenhum arquivo da suíte usa essa forma hoje.
 */
export function semComentario(sql: string): string {
  let saida = "";
  let i = 0;

  while (i < sql.length) {
    const par = sql.slice(i, i + 2);

    if (par === "--") {
      const fim = sql.indexOf("\n", i);
      // Comentário até o fim da linha. A quebra é preservada para que número
      // de linha e blocos continuem separados no texto resultante.
      if (fim === -1) break;
      i = fim;
      continue;
    }

    if (par === "/*") {
      const fim = sql.indexOf("*/", i + 2);
      if (fim === -1) break;
      i = fim + 2;
      continue;
    }

    if (sql[i] === "'") {
      const inicio = i;
      i++;
      while (i < sql.length) {
        if (sql[i] === "'") {
          // Aspa dobrada é aspa literal dentro da string, não o fim dela.
          if (sql[i + 1] === "'") {
            i += 2;
            continue;
          }
          i++;
          break;
        }
        i++;
      }
      saida += sql.slice(inicio, i);
      continue;
    }

    saida += sql[i];
    i++;
  }

  return saida;
}

/** Os asserts de supabase/tests, em ordem alfabética (a mesma do glob do runner). */
export function lerAsserts(): ArquivoSql[] {
  return readdirSync(DIR_ASSERTS)
    .filter((nome) => nome.endsWith(".sql"))
    .sort()
    .map((arquivo) => {
      const bruto = readFileSync(new URL(arquivo, DIR_ASSERTS), "utf8");
      return { arquivo, bruto, codigo: semComentario(bruto) };
    });
}

/**
 * O assert depende do ambiente (grupo 2) em vez de criar o próprio usuário?
 *
 * Duas marcas, porque as duas aparecem juntas mas nada garante que continuem:
 * ler `app.test_user_id` e cair no `order by created_at` quando ele falta.
 * Qualquer uma das duas já obriga o shim a provisionar usuário.
 */
export function dependeDoAmbiente(codigo: string): boolean {
  const leSetting = /current_setting\s*\(\s*'app\.test_user_id'/i.test(codigo);
  const usaFallback = /from\s+auth\.users\s+order\s+by\s+created_at/i.test(codigo);
  return leSetting || usaFallback;
}

/** Literais de `raise notice` presentes no código, já sem as aspas externas. */
export function noticesDeSucesso(codigo: string): string[] {
  const achados: string[] = [];
  const padrao = /raise\s+notice\s+'((?:[^']|'')*)'/gi;

  for (const casamento of codigo.matchAll(padrao)) {
    achados.push(casamento[1].replaceAll("''", "'"));
  }
  return achados;
}

/**
 * O que tests/sql/00_shim_auth.sql provisiona, do ponto de vista do contrato
 * do grupo 2: a tabela, a coluna pela qual o fallback ordena, e um usuário
 * commitado para o fallback encontrar.
 */
export function lerShim(): Shim {
  const codigo = semComentario(readFileSync(CAMINHO_SHIM, "utf8"));

  const criaAuthUsers = /create\s+table\s+(if\s+not\s+exists\s+)?auth\.users/i.test(codigo);
  const criaComCreatedAt = /create\s+table[^;]*auth\.users[^;]*created_at/i.test(codigo);
  const alteraParaCreatedAt =
    /alter\s+table\s+auth\.users[^;]*add\s+column[^;]*created_at/i.test(codigo);
  const insereFixture = /insert\s+into\s+auth\.users\b/i.test(codigo);

  return {
    criaAuthUsers,
    temCreatedAt: criaComCreatedAt || alteraParaCreatedAt,
    insereFixture,
  };
}
