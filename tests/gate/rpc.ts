// As funcões que supabase/migrations/*.sql declara, e o search_path delas.
//
// CONTRATO
//   Faz     — lê as migrações, calcula os trechos que são literal de string, e
//             devolve cada `create function` com nome, arquivo, linha, se é
//             SECURITY DEFINER e qual `search_path` ela fixa. Mais a primeira
//             regra: definer de `public` fixa `search_path = ''`.
//   Não faz — não conecta em banco, não executa SQL e não afirma nada sobre os
//             privilégios reais do schema. É análise de texto.
//   Recusa  — função sem corpo dollar-quote, e `create function` que nasça
//             DENTRO de um literal, lançam Error citando arquivo e nome.
//   Vermelho— provado com SQL sintético em tests/unit/gate-rpc-search-path.test.ts.
//
// POR QUE ISTO EXISTE:
// a escrita neste schema passa quase toda por RPC `SECURITY DEFINER`. Uma
// função DEFINER roda com o privilégio de quem a criou, então ela atravessa a
// RLS de propósito — e o que a impede de virar escalada de privilégio é o
// `search_path` fixo. Sem ele, qualquer objeto que o chamador consiga colocar
// à frente no path (uma tabela `public.faturas` num schema temporário do
// próprio usuário) passa a ser o objeto que a função de confiança manipula.
// Isso está escrito em prosa no CLAUDE.md do produto desde a 0005. Prosa não
// reprova ninguém.
//
// POR QUE ESTE ARQUIVO NAO USA `semLiteral` DE tests/gate/migracoes.ts:
// porque ele apagaria justamente o dado. `set search_path = 'pg_catalog'` tem
// o valor DENTRO de um literal — esvaziar literal transforma isso em
// `search_path = ''`, que é o valor SEGURO. Medido: a primeira passada deste
// ciclo, feita com `semLiteral`, leu 57 de 57 definers como seguros e escondeu
// a única exceção real do repositório. Aqui os literais ficam, e o extrator
// calcula os SPANS deles para saber quando um match caiu dentro de um.
import { readdirSync, readFileSync } from "node:fs";
import { semComentario } from "../unit/_asserts-sql.ts";
import { linhaDe } from "./migracoes.ts";

const RAIZ = new URL("../../", import.meta.url);
const DIR_MIGRACOES = new URL("supabase/migrations/", RAIZ);

/** O schema que este gate vigia. */
export const SCHEMA_VIGIADO = "public";

/**
 * O único `search_path` aceito para função DEFINER.
 *
 * Vazio é o único valor que não depende de nada: qualquer objeto citado no
 * corpo precisa ser qualificado por schema, e não há path para envenenar.
 * `pg_catalog` NÃO entra aqui — é permissivo o bastante para importar, e no
 * repositório de hoje ele é drift transcrito de produção, não escolha.
 */
export const SEARCH_PATH_SEGURO = "''";

export interface Trecho {
  readonly inicio: number;
  /** Exclusivo. */
  readonly fim: number;
}

export interface Funcao {
  /** Qualificado, minúsculo, sem a lista de argumentos: `public.fechar_faturas`. */
  readonly nome: string;
  readonly arquivo: string;
  readonly linha: number;
  readonly definer: boolean;
  /** O valor cru lido, com as aspas: `''` ou `'pg_catalog'`. `null` se ausente. */
  readonly searchPath: string | null;
}

export interface MigracaoLida {
  readonly arquivo: string;
  readonly bruto: string;
  /** Sem comentário. Os literais ficam — ver o cabeçalho. */
  readonly codigo: string;
  readonly literais: readonly Trecho[];
}

// ------------------------------------------------------------ spans de literal

/**
 * Onde cada literal `'...'` começa e termina.
 *
 * Devolver os trechos em vez de apagá-los é a diferença entre este extrator e
 * o de tests/gate/migracoes.ts: aqui o conteúdo do literal É o dado, e a
 * posição dele é o que diz se um `create`/`revoke`/`grant` é DDL de verdade ou
 * texto dentro de um `execute '...'`.
 *
 * Aspa dobrada (`''`) é aspa dentro da string. Literal que não fecha é recusa:
 * a partir dali todo veredito seria sobre texto deslocado.
 */
export function spansDeLiteral(sql: string, arquivo: string): Trecho[] {
  const trechos: Trecho[] = [];
  let i = 0;

  while (i < sql.length) {
    if (sql[i] !== "'") {
      i++;
      continue;
    }

    const inicio = i;
    i++;
    let fechou = false;

    while (i < sql.length) {
      if (sql[i] === "'") {
        if (sql[i + 1] === "'") {
          i += 2;
          continue;
        }
        i++;
        fechou = true;
        break;
      }
      i++;
    }

    if (!fechou) {
      throw new Error(
        `${arquivo}: literal de string aberto na linha ${linhaDe(sql, inicio)} e ` +
          `nunca fechado. Depois disso não dá para dizer o que é comando e o que ` +
          `é dado.`,
      );
    }

    trechos.push({ inicio, fim: i });
  }

  return trechos;
}

/** O literal que contém um índice, ou `null` se ele está em código aberto. */
export function literalEm(trechos: readonly Trecho[], indice: number): Trecho | null {
  return trechos.find((t) => indice >= t.inicio && indice < t.fim) ?? null;
}

// ------------------------------------------------------------------- leitura

/** As migrações do disco, em ordem alfabética. */
export function lerMigracoesRpc(dir: URL = DIR_MIGRACOES): MigracaoLida[] {
  return readdirSync(dir)
    .filter((arquivo) => arquivo.endsWith(".sql"))
    .sort()
    .map((arquivo) => {
      const bruto = readFileSync(new URL(arquivo, dir), "utf8");
      const codigo = semComentario(bruto);
      return { arquivo, bruto, codigo, literais: spansDeLiteral(codigo, arquivo) };
    });
}

const RE_FUNCAO = /\bcreate\s+(?:or\s+replace\s+)?function\s+([\w".]+)/gi;

/** A abertura do corpo: `as $fn$`, `as $$`, `$function$`. */
const RE_DOLLAR = /\$[A-Za-z_]*\$/;

function normalizar(nome: string): string {
  return nome.replace(/"/g, "").toLowerCase();
}

/**
 * O cabeçalho de uma função: do `create` até a abertura do corpo.
 *
 * É onde vivem `security definer`, `language` e `set search_path` — e é o
 * único trecho em que faz sentido procurá-los. Buscar no corpo acharia o
 * `pg_catalog.clock_timestamp()` de qualquer trigger e leria como opção.
 *
 * Sem delimitador dollar-quote antes da próxima função, recusa. Função escrita
 * numa forma que este gate não conhece precisa aparecer, não sumir da conta.
 */
function cabecalhoDe(codigo: string, desde: number, ate: number, alvo: string): string {
  const resto = codigo.slice(desde, ate);
  const casa = RE_DOLLAR.exec(resto);

  if (!casa) {
    throw new Error(
      `${alvo}: não achei a abertura do corpo (\`as $tag$\`) antes da próxima ` +
        `função. Ou a declaração usa uma forma que este gate não conhece, ou ela ` +
        `está incompleta — nos dois casos, calar deixaria a função fora da ` +
        `conferência de search_path.`,
    );
  }

  return resto.slice(0, casa.index);
}

/** Todas as funções declaradas, uma entrada por `create function`. */
export function extrairFuncoes(migracoes: readonly MigracaoLida[]): Funcao[] {
  const achadas: Funcao[] = [];

  for (const m of migracoes) {
    RE_FUNCAO.lastIndex = 0;
    const inicios: number[] = [];
    const nomes: string[] = [];

    for (let casa = RE_FUNCAO.exec(m.codigo); casa; casa = RE_FUNCAO.exec(m.codigo)) {
      const literal = literalEm(m.literais, casa.index);
      if (literal) {
        throw new Error(
          `${m.arquivo}: \`create function\` na linha ${linhaDe(m.codigo, casa.index)} ` +
            `nasce dentro de um literal de string. DDL montado em tempo de execução ` +
            `está fora do que este gate sabe decidir, e contá-lo como declaração ` +
            `real seria inventar uma função que talvez nunca seja criada.`,
        );
      }
      inicios.push(casa.index + casa[0].length);
      nomes.push(normalizar(casa[1]));
    }

    for (let i = 0; i < inicios.length; i++) {
      const nome = nomes[i];
      if (nome.split(".")[0] !== SCHEMA_VIGIADO) continue;

      const cabecalho = cabecalhoDe(
        m.codigo,
        inicios[i],
        i + 1 < inicios.length ? inicios[i + 1] : m.codigo.length,
        `${m.arquivo}: função ${nome}`,
      );
      const sp = /\bset\s+search_path\s*(?:=|to)\s*('[^']*'|[^\s;]+)/i.exec(cabecalho);

      achadas.push({
        nome,
        arquivo: m.arquivo,
        linha: linhaDe(m.codigo, inicios[i]),
        definer: /\bsecurity\s+definer\b/i.test(cabecalho),
        searchPath: sp ? sp[1].toLowerCase() : null,
      });
    }
  }

  return achadas;
}

/** Atalho para um trecho solto — é o que os REDs sintéticos usam. */
export function funcoesDe(sql: string, arquivo = "<sintetico>.sql"): Funcao[] {
  const codigo = semComentario(sql);
  return extrairFuncoes([
    { arquivo, bruto: sql, codigo, literais: spansDeLiteral(codigo, arquivo) },
  ]);
}

// --------------------------------------------------- regra (a): search_path

/** Como uma queixa identifica a função. Casado com a lista de exceções. */
export function chaveDaFuncao(nome: string): string {
  return `funcao:${nome}`;
}

/**
 * Uma queixa por definer de `public` que não fixa `search_path = ''`.
 *
 * Só DEFINER é cobrado. Função INVOKER roda com o privilégio de quem chama:
 * um search_path envenenado ali não escala nada, porque o atacante já tinha
 * aquele privilégio. Cobrar das duas encheria a saída de queixa sem risco, e
 * vermelho sem risco treina gente a silenciar o teste.
 */
export function queixasDeSearchPath(funcoes: readonly Funcao[]): string[] {
  return funcoes
    .filter((f) => f.definer && f.searchPath !== SEARCH_PATH_SEGURO)
    .map((f) =>
      f.searchPath === null
        ? `${f.nome} (${f.arquivo}:${f.linha}) é SECURITY DEFINER e não fixa ` +
          `\`set search_path = ''\`. Ela roda com o privilégio do criador e ` +
          `resolve nomes pelo path de QUEM CHAMA: um objeto plantado à frente ` +
          `vira o objeto que a função de confiança manipula.`
        : `${f.nome} (${f.arquivo}:${f.linha}) é SECURITY DEFINER e fixa ` +
          `search_path = ${f.searchPath}, não ${SEARCH_PATH_SEGURO}. Só o vazio ` +
          `não depende de nada — com qualquer schema no path, o nome não ` +
          `qualificado dentro do corpo passa a ter dono incerto.`,
    );
}
