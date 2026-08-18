// Os privilégios que as migrações precisam pedir para cada RPC, e as isenções.
//
// CONTRATO
//   Garante  — que sobre as funções extraídas por tests/gate/rpc.ts valem as
//              três regras que o CLAUDE.md deste projeto declara em prosa:
//              (a) definer com `search_path = ''`, (b) `revoke execute`
//              nomeando `public` e `anon`, (c) `grant execute` só para o papel
//              pretendido. Mais (d): isenção declarada para função que já
//              cumpre a regra, ou que nem existe, é queixa.
//   Não faz  — não lê disco (quem lê é rpc.ts), não executa SQL e não afirma
//              nada sobre os privilégios REAIS do banco. E não conserta nada.
//   Escopo   — schema `public`.
//   Vermelho — provado com SQL sintético em
//              tests/unit/gate-rpc-privilegios.test.ts.
//
// POR QUE `revoke` E `grant` SAO REGRAS SEPARADAS, E POR QUE SO UMA E OBRIGATORIA:
// no Postgres, função nasce com `execute` concedido a `PUBLIC`. Quer dizer que
// criar uma RPC `SECURITY DEFINER` e parar por aí publica uma função de
// privilégio elevado para `anon` — o papel do visitante não autenticado. Por
// isso o `revoke` é obrigatório para TODO definer: ele desfaz um default do
// banco, e default que ninguém desfez não aparece em diff nenhum.
//
// O `grant`, não. Medido neste repositório: 7 definers distintos não têm grant
// nenhum — `fn_sync_soft_delete_parcelas`, `fn_touch_updated_at`,
// `fechar_faturas`, `fn_sugerir_categoria`, `fn_autocategorizar_transacao`,
// `fn_proxima_ocorrencia` e `rls_auto_enable`. São função de trigger e de cron,
// chamadas pelo próprio banco, não por cliente. Exigir grant delas seria o gate
// mandando ABRIR privilégio que hoje está fechado — um gate de segurança com o
// sinal invertido. A regra é: grant que EXISTE só pode apontar para o papel
// pretendido.
import {
  SCHEMA_VIGIADO,
  chaveDaFuncao,
  literalEm,
  queixasDeSearchPath,
  type Funcao,
  type MigracaoLida,
} from "./rpc.ts";
import { linhaDe } from "./migracoes.ts";

/** Os papéis a quem uma RPC deste projeto pode ser concedida. */
export const PAPEIS_PRETENDIDOS: readonly string[] = ["authenticated"];

/** Os papéis de quem o `execute` precisa ser revogado, por nome. */
export const PAPEIS_REVOGADOS: readonly string[] = ["public", "anon"];

export type RegraRpc = "search-path" | "revoke" | "grant";

export interface Privilegio {
  readonly tipo: "revoke" | "grant";
  /** Qualificado e minúsculo, sem a lista de argumentos. */
  readonly funcao: string;
  readonly papeis: readonly string[];
  readonly arquivo: string;
  readonly linha: number;
  /** `true` quando o comando nasce dentro de um `execute '...'`. */
  readonly dinamico: boolean;
}

export interface QueixaRpc {
  readonly regra: RegraRpc;
  /** A chave de tests/gate/rpc.ts: `funcao:public.x`. */
  readonly funcao: string;
  readonly texto: string;
}

/**
 * Uma isenção declarada, casada por (regra, função).
 *
 * O par, e não o nome solto: isentar `rls_auto_enable` do `search_path` não
 * pode isentá-la também do `revoke`. Uma isenção compra uma regra por vez.
 */
export interface ExcecaoRpc {
  readonly regra: RegraRpc;
  readonly funcao: string;
  readonly motivo: string;
  readonly oQueExigeRemover: string;
}

/**
 * As isenções aceitas hoje. Uma só, e ela é drift conhecido.
 *
 * Mesmo mecanismo do `DIVERGENCIA_DECLARADA` de tests/gate/postgres.ts: a
 * isenção envelhece mal de propósito. No instante em que a função passar a
 * cumprir a regra, esta declaração vira queixa órfã e precisa sair.
 */
export const EXCECOES_RPC: readonly ExcecaoRpc[] = [
  {
    regra: "search-path",
    funcao: chaveDaFuncao("public.rls_auto_enable"),
    motivo:
      "a 0027 traz esta função como TRANSCRIÇÃO LITERAL de pg_get_functiondef " +
      "contra o projeto de produção — o corpo, o SECURITY DEFINER e o " +
      "`search_path TO 'pg_catalog'` são o que já roda lá. A própria migração " +
      "declara, em comentário, que não é refatoração: corrigir drift e mudar " +
      "comportamento na mesma migração tornaria impossível saber qual dos dois " +
      "quebrou algo. Trocar para '' aqui faria a migração deixar de descrever " +
      "produção, que é o defeito que a 0027 existe para consertar. E o risco " +
      "concreto é menor do que o caso geral: o corpo só chama pg_catalog.* e " +
      "format(), e o gatilho é DDL, não entrada de usuário.",
    oQueExigeRemover:
      "alinhar produção e migração em `set search_path = ''` — aplicar a troca " +
      "no banco, transcrever de novo com pg_get_functiondef para confirmar que " +
      "bateu, e então apagar esta declaração. O gate cobra que ela suma quando " +
      "a função passar a cumprir a regra.",
  },
];

// ------------------------------------------------------ extração de privilégio

const RE_REVOKE = /\brevoke\s+(?:all\s+privileges\s+on|all\s+on|execute\s+on)\s+function\s+([\w".]+)/gi;
const RE_GRANT = /\bgrant\s+(?:all\s+privileges\s+on|all\s+on|execute\s+on)\s+function\s+([\w".]+)/gi;

function normalizar(nome: string): string {
  return nome.replace(/"/g, "").toLowerCase();
}

/**
 * Onde um comando termina.
 *
 * Comando em código aberto termina no `;`. Comando que nasce DENTRO de um
 * literal termina na aspa que fecha o literal — o `;` que vem logo depois é do
 * `execute`, não dele. É o caso do `execute 'revoke execute on function
 * public.rls_auto_enable() from public, anon, authenticated'` da 0022: sem esta
 * distinção, a lista de papéis sairia com uma aspa colada em `authenticated`.
 */
function fimDoComando(m: MigracaoLida, inicio: number, alvo: string): number {
  const literal = literalEm(m.literais, inicio);
  if (literal) return literal.fim - 1;

  const ponto = m.codigo.indexOf(";", inicio);
  if (ponto === -1) {
    throw new Error(
      `${m.arquivo}: ${alvo} não tem \`;\` terminando o comando. Sem o fim não ` +
        `dá para saber quais papéis ele nomeia, e ler uma lista pela metade ` +
        `pode parecer que revoga sem revogar.`,
    );
  }
  return ponto;
}

/**
 * Os papéis de uma lista `from ...` / `to ...`.
 *
 * Fragmento que não seja identificador simples é recusa: `group x`, uma
 * expressão, ou lixo de parsing precisam aparecer. Normalizar em silêncio aqui
 * seria o gate inventando a lista que ele queria ler.
 */
export function papeisDe(lista: string, alvo: string): string[] {
  return lista.split(",").map((bruto) => {
    const papel = bruto.trim().toLowerCase();
    if (!/^[a-z_]\w*$/.test(papel)) {
      throw new Error(
        `${alvo}: não sei ler "${bruto.trim()}" como nome de papel. Este gate ` +
          `entende identificador simples separado por vírgula — lista ilegível ` +
          `viraria conclusão sobre privilégio que ninguém conferiu.`,
      );
    }
    return papel;
  });
}

function extrair(
  m: MigracaoLida,
  re: RegExp,
  tipo: "revoke" | "grant",
  preposicao: RegExp,
): Privilegio[] {
  const achados: Privilegio[] = [];
  re.lastIndex = 0;

  for (let casa = re.exec(m.codigo); casa; casa = re.exec(m.codigo)) {
    const funcao = normalizar(casa[1]);
    if (funcao.split(".")[0] !== SCHEMA_VIGIADO) continue;

    const linha = linhaDe(m.codigo, casa.index);
    const alvo = `${m.arquivo}:${linha}: ${tipo} em ${funcao}`;
    const corpo = m.codigo.slice(casa.index, fimDoComando(m, casa.index, alvo));
    const lista = preposicao.exec(corpo);

    if (!lista) {
      throw new Error(
        `${alvo} não diz de/para quem. Um ${tipo} sem lista de papéis não é ` +
          `comando incompleto por acaso — é um comando cujo efeito este gate ` +
          `não consegue afirmar.`,
      );
    }

    achados.push({
      tipo,
      funcao,
      papeis: papeisDe(lista[1], alvo),
      arquivo: m.arquivo,
      linha,
      dinamico: literalEm(m.literais, casa.index) !== null,
    });
  }

  return achados;
}

export function extrairPrivilegios(migracoes: readonly MigracaoLida[]): Privilegio[] {
  return migracoes.reduce<Privilegio[]>(
    (acc, m) =>
      acc
        .concat(extrair(m, RE_REVOKE, "revoke", /\bfrom\s+([^;]+)/i))
        .concat(extrair(m, RE_GRANT, "grant", /\bto\s+([^;]+)/i)),
    [],
  );
}

// -------------------------------------------------- regra (b): revoke por nome

/**
 * Uma queixa por definer distinto sem `revoke execute` nomeando `public` e `anon`.
 *
 * Nomeado, e não "algum revoke": revogar de `public` sozinho deixa `anon`
 * herdando por outro caminho em setups do Supabase, e revogar de `anon` sem
 * `public` deixa o default do Postgres de pé. Os dois nomes ou nada.
 *
 * `revoke` dinâmico (dentro de `execute '...'`) CONTA. O da 0022 está guardado
 * por um `if exists` sobre o catálogo e é a forma correta de revogar algo que
 * pode ainda não existir naquela ordem de migração.
 */
export function queixasDeRevoke(
  funcoes: readonly Funcao[],
  privilegios: readonly Privilegio[],
): QueixaRpc[] {
  const revogados = new Set(
    privilegios
      .filter(
        (p) =>
          p.tipo === "revoke" &&
          PAPEIS_REVOGADOS.every((papel) => p.papeis.indexOf(papel) !== -1),
      )
      .map((p) => p.funcao),
  );

  const distintos: string[] = [];
  for (const f of funcoes) {
    if (f.definer && distintos.indexOf(f.nome) === -1) distintos.push(f.nome);
  }

  return distintos
    .filter((nome) => !revogados.has(nome))
    .map((nome) => ({
      regra: "revoke" as const,
      funcao: chaveDaFuncao(nome),
      texto:
        `${nome} é SECURITY DEFINER e nenhuma migração revoga \`execute\` dela ` +
        `nomeando ${PAPEIS_REVOGADOS.join(" e ")}. Função no Postgres NASCE com ` +
        `execute concedido a PUBLIC: sem o revoke, uma RPC de privilégio ` +
        `elevado fica publicada para o visitante nao autenticado, e isso nao ` +
        `aparece em diff nenhum porque e um default do banco.`,
    }));
}

// ----------------------------------------------- regra (c): grant só ao papel

/**
 * Uma queixa por `grant execute` que nomeie papel fora dos pretendidos.
 *
 * Não exige que exista grant — ver o cabeçalho. O que ela reprova é o grant que
 * abre demais, com `grant ... to public` e `to anon` como o caso óbvio: ele
 * desfaz, na linha seguinte, o revoke que a regra (b) acabou de cobrar.
 */
export function queixasDeGrant(privilegios: readonly Privilegio[]): QueixaRpc[] {
  const queixas: QueixaRpc[] = [];

  for (const p of privilegios) {
    if (p.tipo !== "grant") continue;
    for (const papel of p.papeis) {
      if (PAPEIS_PRETENDIDOS.indexOf(papel) !== -1) continue;
      queixas.push({
        regra: "grant",
        funcao: chaveDaFuncao(p.funcao),
        texto:
          `${p.arquivo}:${p.linha} concede \`execute\` de ${p.funcao} para ` +
          `"${papel}", que não está entre os papéis pretendidos ` +
          `(${PAPEIS_PRETENDIDOS.join(", ")}). Grant largo desfaz na linha ` +
          `seguinte o revoke que a regra do revoke acabou de cobrar.`,
      });
    }
  }

  return queixas;
}

// -------------------------------------------------- as queixas, e as órfãs

/** As três regras aplicadas, antes de qualquer isenção. */
export function queixasCruas(
  funcoes: readonly Funcao[],
  privilegios: readonly Privilegio[],
): QueixaRpc[] {
  // Uma função por vez para saber QUAL gerou a queixa, sem uma segunda cópia
  // da regra de tests/gate/rpc.ts aqui.
  const deSearchPath = funcoes.reduce<QueixaRpc[]>(
    (acc, f) =>
      acc.concat(
        queixasDeSearchPath([f]).map((texto) => ({
          regra: "search-path" as const,
          funcao: chaveDaFuncao(f.nome),
          texto,
        })),
      ),
    [],
  );

  return deSearchPath
    .concat(queixasDeRevoke(funcoes, privilegios))
    .concat(queixasDeGrant(privilegios));
}

function casa(e: ExcecaoRpc, q: QueixaRpc): boolean {
  return e.regra === q.regra && e.funcao === q.funcao;
}

/** Uma queixa por isenção que não isenta nada. */
export function queixasOrfas(
  excecoes: readonly ExcecaoRpc[],
  cruas: readonly QueixaRpc[],
  funcoes: readonly Funcao[],
): string[] {
  const existentes = new Set(funcoes.map((f) => chaveDaFuncao(f.nome)));

  return excecoes
    .filter((e) => !cruas.some((q) => casa(e, q)))
    .map((e) =>
      existentes.has(e.funcao)
        ? `a exceção de "${e.regra}" declarada para ${e.funcao} é órfã: a função ` +
          `já cumpre a regra. Apague a declaração — isenção que sobrevive ao ` +
          `fato vira folclore, e o próximo leitor acredita nela.`
        : `a exceção de "${e.regra}" declarada para ${e.funcao} aponta para uma ` +
          `função que nenhuma migração cria. Ou o nome está errado, ou a função ` +
          `foi removida e a isenção ficou para trás.`,
    );
}

/**
 * Todas as queixas: as três regras menos o que está isento, mais as órfãs.
 *
 * Lista vazia é o único estado aprovado, e a ordem é estável (search-path,
 * revoke, grant, órfãs) para que a mensagem de falha não mude de forma entre
 * duas execuções idênticas.
 */
export function queixasDeRpc(
  funcoes: readonly Funcao[],
  privilegios: readonly Privilegio[],
  excecoes: readonly ExcecaoRpc[] = EXCECOES_RPC,
): string[] {
  const cruas = queixasCruas(funcoes, privilegios);

  return cruas
    .filter((q) => !excecoes.some((e) => casa(e, q)))
    .map((q) => q.texto)
    .concat(queixasOrfas(excecoes, cruas, funcoes));
}
