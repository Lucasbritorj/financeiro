// Os objetos que supabase/migrations/*.sql declara, lidos do texto.
//
// CONTRATO
//   Faz     — lê as migrações, descarta comentário e o CONTEÚDO de literal de
//             string, e devolve as tabelas, views, policies e habilitações de
//             RLS declaradas, cada uma com arquivo e linha. Mais a primeira
//             regra: view de public precisa declarar security_invoker = true.
//   Não faz — não conecta em banco, não executa SQL e não afirma nada sobre o
//             estado real do schema. É análise de texto sobre o que as
//             migrações PEDEM, não sobre o que o Postgres TEM.
//   Recusa  — bloco que ele não sabe ler lança Error citando arquivo e objeto.
//             Devolver lista vazia ali seria gate verde por ilegibilidade, que
//             é o modo de falha que este arquivo existe para não ter.
//   Vermelho— provado com SQL sintético em tests/unit/gate-migracoes-views.test.ts.
//
// POR QUE ISTO EXISTE:
// o isolamento por usuário deste projeto depende de três coisas ditas em
// prosa no CLAUDE.md do produto — view com security_invoker, tabela com RLS,
// policy filtrando por auth.uid(). Prosa não reprova ninguém. Uma view nova
// sem `with (security_invoker = true)` roda com o privilégio do DONO, bypassa
// a RLS das tabelas-base e devolve as linhas de TODOS os usuários; e o dia em
// que isso acontece é um dia de push comum, não um dia de auditoria.
//
// POR QUE PARSER DE TEXTO, E NÃO UM PARSER DE SQL DE VERDADE:
// a alternativa considerada foi `libpg-query`/`pgsql-parser`, que dá a árvore
// real do Postgres e acabaria com toda a heurística abaixo. Recusada: ela
// compila código nativo na instalação, e este repositório roda os gates com
// `node --test`, sem Docker e sem build step, justamente para que o veredito
// exista antes do push. Somar uma dependência com postinstall nativo mexeria
// no `npm ci` — que é o passo onde este CI mais morreu. O preço de recusar é
// esta heurística; ele é pago com a recusa explícita e com os REDs sintéticos.
import { readdirSync, readFileSync } from "node:fs";
import { semComentario } from "../unit/_asserts-sql.ts";

const RAIZ = new URL("../../", import.meta.url);
const DIR_MIGRACOES = new URL("supabase/migrations/", RAIZ);

/** O schema que este gate vigia. Objeto de outro schema é ignorado, não aprovado. */
export const SCHEMA_VIGIADO = "public";

export interface Migracao {
  /** Nome do arquivo, para a queixa apontar o culpado. */
  readonly arquivo: string;
  /** Conteúdo cru, como está no disco. */
  readonly bruto: string;
  /** Sem comentário e sem conteúdo de literal. É sobre ele que tudo decide. */
  readonly codigo: string;
}

/** De onde um objeto veio. Toda queixa carrega isto. */
export interface Origem {
  readonly arquivo: string;
  readonly linha: number;
}

export interface Tabela extends Origem {
  /** Qualificado, minúsculo: `public.faturas`. */
  readonly nome: string;
}

export interface View extends Origem {
  readonly nome: string;
  /** As opções do `with (...)`, chave minúscula e valor minúsculo. */
  readonly opcoes: Readonly<Record<string, string>>;
}

export interface Policy extends Origem {
  readonly nome: string;
  /** A tabela alvo, qualificada e minúscula. */
  readonly tabela: string;
  /** Do `on <tabela>` até o `;`. É onde `auth.uid()` precisa aparecer. */
  readonly corpo: string;
}

export interface HabilitaRls extends Origem {
  readonly tabela: string;
}

export interface Objetos {
  readonly tabelas: readonly Tabela[];
  readonly views: readonly View[];
  readonly policies: readonly Policy[];
  readonly rls: readonly HabilitaRls[];
}

// --------------------------------------------------------------- leitura crua

/**
 * Esvazia o conteúdo de todo literal `'...'`, preservando as quebras de linha.
 *
 * É o que impede a 0027 de inventar objeto: ela lista `'CREATE TABLE'` dentro
 * de um `IN (...)` e monta `format('alter table %s enable row level
 * security')`. Sem esta passada, o extrator leria dali uma tabela que não
 * existe e uma habilitação de RLS que nunca é executada por aquela linha — e
 * a segunda é pior, porque APROVA uma tabela de mentira.
 *
 * As quebras ficam para que o número de linha reportado continue batendo com
 * o arquivo no disco. Aspa dobrada (`''`) é aspa dentro da string, não o fim.
 *
 * Literal que não fecha é recusa: seguir em frente com o resto do arquivo
 * deslocado produziria queixas sobre texto que não existe.
 */
export function semLiteral(sql: string, arquivo: string): string {
  let saida = "";
  let i = 0;

  while (i < sql.length) {
    if (sql[i] !== "'") {
      saida += sql[i];
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
          `nunca fechado. Não dá para dizer o que é código e o que é dado depois ` +
          `disso, e adivinhar viraria queixa sobre texto inexistente.`,
      );
    }

    saida += "''" + sql.slice(inicio, i).replace(/[^\n]/g, "");
  }

  return saida;
}

/** A linha (1-based) em que um índice cai. */
export function linhaDe(texto: string, indice: number): number {
  let linhas = 1;
  for (let i = 0; i < indice && i < texto.length; i++) {
    if (texto[i] === "\n") linhas++;
  }
  return linhas;
}

/** As migrações do disco, em ordem alfabética — a mesma em que o Supabase aplica. */
export function lerMigracoes(dir: URL = DIR_MIGRACOES): Migracao[] {
  return readdirSync(dir)
    .filter((arquivo) => arquivo.endsWith(".sql"))
    .sort()
    .map((arquivo) => {
      const bruto = readFileSync(new URL(arquivo, dir), "utf8");
      return { arquivo, bruto, codigo: semLiteral(semComentario(bruto), arquivo) };
    });
}

// ------------------------------------------------------------------ extração

/** Tira aspas de identificador e normaliza para minúsculo. */
function normalizar(nome: string): string {
  return nome.replace(/"/g, "").toLowerCase();
}

/**
 * O schema de um nome qualificado, ou recusa.
 *
 * Nome sem ponto é recusa e não "provavelmente public": o schema efetivo
 * dependeria do `search_path` em tempo de execução, que este gate não pode
 * ler. Aprovar por omissão deixaria passar exatamente a tabela nova que
 * ninguém qualificou.
 */
function schemaDe(nome: string, arquivo: string, oQue: string): string {
  const partes = normalizar(nome).split(".");

  if (partes.length !== 2 || !partes[0] || !partes[1]) {
    throw new Error(
      `${arquivo}: ${oQue} "${nome}" não está qualificado por schema. Este gate ` +
        `só sabe decidir sobre nome no formato <schema>.<objeto> — o schema de um ` +
        `nome solto depende do search_path em runtime, e supor "public" aprovaria ` +
        `por omissão justamente o objeto que ninguém qualificou.`,
    );
  }

  return partes[0];
}

const RE_TABELA =
  /\bcreate\s+(?:(?:global|local)\s+)?(?:(?:temp|temporary|unlogged)\s+)?table\s+(?:if\s+not\s+exists\s+)?([\w".]+)/gi;

const RE_VIEW =
  /\bcreate\s+(?:or\s+replace\s+)?(?:(?:temp|temporary)\s+)?(?:materialized\s+)?view\s+(?:if\s+not\s+exists\s+)?([\w".]+)/gi;

const RE_POLICY = /\bcreate\s+policy\s+([\w".]+)\s+on\s+([\w".]+)/gi;

const RE_RLS =
  /\balter\s+table\s+(?:if\s+exists\s+)?([\w".]+)\s+enable\s+row\s+level\s+security\b/gi;

/** As tabelas de `public` criadas por um arquivo. */
function extrairTabelas(m: Migracao): Tabela[] {
  const achadas: Tabela[] = [];
  RE_TABELA.lastIndex = 0;

  for (let casa = RE_TABELA.exec(m.codigo); casa; casa = RE_TABELA.exec(m.codigo)) {
    if (schemaDe(casa[1], m.arquivo, "create table") !== SCHEMA_VIGIADO) continue;
    achadas.push({
      nome: normalizar(casa[1]),
      arquivo: m.arquivo,
      linha: linhaDe(m.codigo, casa.index),
    });
  }

  return achadas;
}

/**
 * As opções de um `with (...)` que segue o nome da view, e onde ele termina.
 *
 * Devolve `null` quando não há cláusula `with` — view sem opção nenhuma é
 * legal, e é justamente o caso que a regra reprova depois.
 */
function lerOpcoes(
  codigo: string,
  desde: number,
  arquivo: string,
  view: string,
): { readonly opcoes: Record<string, string>; readonly fim: number } | null {
  const resto = codigo.slice(desde);
  const casa = /^\s*with\s*\(/i.exec(resto);
  if (!casa) return null;

  const abre = desde + casa[0].length;
  let profundidade = 1;
  let i = abre;

  while (i < codigo.length && profundidade > 0) {
    if (codigo[i] === "(") profundidade++;
    if (codigo[i] === ")") profundidade--;
    i++;
  }

  if (profundidade > 0) {
    throw new Error(
      `${arquivo}: a cláusula \`with (\` da view ${view} abre e nunca fecha. Sem ` +
        `saber onde ela termina não dá para dizer se security_invoker está lá.`,
    );
  }

  const opcoes: Record<string, string> = {};
  for (const item of codigo.slice(abre, i - 1).split(",")) {
    const par = /^\s*([\w.]+)\s*=\s*(\S+?)\s*$/.exec(item);
    if (!par) {
      throw new Error(
        `${arquivo}: não sei ler a opção "${item.trim()}" da view ${view}. Este ` +
          `gate entende \`chave = valor\` — opção ilegível vira aprovação por ` +
          `silêncio, que é o que ele existe para evitar.`,
      );
    }
    opcoes[par[1].toLowerCase()] = par[2].toLowerCase();
  }

  return { opcoes, fim: i };
}

/** As views de `public` criadas por um arquivo, uma entrada por declaração. */
function extrairViews(m: Migracao): View[] {
  const achadas: View[] = [];
  RE_VIEW.lastIndex = 0;

  for (let casa = RE_VIEW.exec(m.codigo); casa; casa = RE_VIEW.exec(m.codigo)) {
    const nome = normalizar(casa[1]);
    const fimDoNome = casa.index + casa[0].length;
    const lido = lerOpcoes(m.codigo, fimDoNome, m.arquivo, nome);
    const depois = m.codigo.slice(lido ? lido.fim : fimDoNome);

    if (!/^\s*as\b/i.exec(depois)) {
      throw new Error(
        `${m.arquivo}: a view ${nome} não é seguida por \`as\`. Ou a declaração ` +
          `está incompleta, ou ela usa uma forma que este gate não conhece — nos ` +
          `dois casos, calar seria deixar a view fora da conferência.`,
      );
    }

    if (schemaDe(casa[1], m.arquivo, "create view") !== SCHEMA_VIGIADO) continue;

    achadas.push({
      nome,
      opcoes: lido ? lido.opcoes : {},
      arquivo: m.arquivo,
      linha: linhaDe(m.codigo, casa.index),
    });
  }

  return achadas;
}

/** As policies criadas por um arquivo, com o corpo até o `;`. */
function extrairPolicies(m: Migracao): Policy[] {
  const achadas: Policy[] = [];
  RE_POLICY.lastIndex = 0;

  for (let casa = RE_POLICY.exec(m.codigo); casa; casa = RE_POLICY.exec(m.codigo)) {
    const nome = normalizar(casa[1]);
    const inicioDoCorpo = casa.index + casa[0].length;
    const fim = m.codigo.indexOf(";", inicioDoCorpo);

    if (fim === -1) {
      throw new Error(
        `${m.arquivo}: a policy ${nome} não tem \`;\` terminando o comando. Sem o ` +
          `fim do corpo não dá para dizer se ela filtra por auth.uid() — e uma ` +
          `policy lida pela metade pode parecer que filtra sem filtrar.`,
      );
    }

    if (schemaDe(casa[2], m.arquivo, "create policy ... on") !== SCHEMA_VIGIADO) continue;

    achadas.push({
      nome,
      tabela: normalizar(casa[2]),
      corpo: m.codigo.slice(inicioDoCorpo, fim),
      arquivo: m.arquivo,
      linha: linhaDe(m.codigo, casa.index),
    });
  }

  return achadas;
}

/** As habilitações explícitas de RLS de um arquivo. */
function extrairRls(m: Migracao): HabilitaRls[] {
  const achadas: HabilitaRls[] = [];
  RE_RLS.lastIndex = 0;

  for (let casa = RE_RLS.exec(m.codigo); casa; casa = RE_RLS.exec(m.codigo)) {
    if (schemaDe(casa[1], m.arquivo, "alter table") !== SCHEMA_VIGIADO) continue;
    achadas.push({
      tabela: normalizar(casa[1]),
      arquivo: m.arquivo,
      linha: linhaDe(m.codigo, casa.index),
    });
  }

  return achadas;
}

/** Tudo que um conjunto de migrações declara, na ordem em que elas são aplicadas. */
export function extrairObjetos(migracoes: readonly Migracao[]): Objetos {
  const objetos: Objetos = { tabelas: [], views: [], policies: [], rls: [] };

  return migracoes.reduce<Objetos>(
    (acumulado, m) => ({
      tabelas: acumulado.tabelas.concat(extrairTabelas(m)),
      views: acumulado.views.concat(extrairViews(m)),
      policies: acumulado.policies.concat(extrairPolicies(m)),
      rls: acumulado.rls.concat(extrairRls(m)),
    }),
    objetos,
  );
}

/** Atalho para um único trecho de SQL — é o que os REDs sintéticos usam. */
export function objetosDe(sql: string, arquivo = "<sintetico>.sql"): Objetos {
  return extrairObjetos([
    { arquivo, bruto: sql, codigo: semLiteral(semComentario(sql), arquivo) },
  ]);
}

// ---------------------------------------------------- regra (a): view invoker

/** Como uma queixa identifica o objeto de que fala. Casado com a lista de exceções. */
export function chaveDaView(nome: string): string {
  return `view:${nome}`;
}

/**
 * Uma queixa por view de `public` que não declara `security_invoker = true`.
 *
 * Cada DECLARAÇÃO é conferida, não cada nome: `vw_carteira` é redefinida três
 * vezes neste schema, e um `create or replace` intermediário sem a opção
 * abriria uma janela em que a view roda como dono. A última declaração vencer
 * no banco não apaga o que rodou entre uma migração e a seguinte.
 */
export function queixasDeView(views: readonly View[]): string[] {
  return views
    .filter((v) => v.opcoes["security_invoker"] !== "true")
    .map(
      (v) =>
        `${v.nome} (${v.arquivo}:${v.linha}) não declara \`with (security_invoker = ` +
        `true)\`. View sem isso roda com o privilégio do DONO: ela bypassa a RLS ` +
        `das tabelas-base e devolve as linhas de todos os usuários.`,
    );
}
