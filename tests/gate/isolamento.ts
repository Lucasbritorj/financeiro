// O isolamento por usuário que as migrações precisam pedir, e as isenções.
//
// CONTRATO
//   Garante  — que sobre os objetos extraídos por tests/gate/migracoes.ts valem
//              as três regras que o CLAUDE.md deste projeto declara em prosa:
//              (a) view de public com security_invoker = true, (b) tabela de
//              public com RLS habilitada, (c) policy citando auth.uid(). Mais
//              (d): isenção declarada para objeto que já cumpre a regra, ou
//              que nem existe, é queixa.
//   Não faz  — não lê disco (quem lê é migracoes.ts), não executa SQL e não
//              afirma nada sobre o schema real. E não conserta nada: objeto
//              vermelho aqui é trabalho de quem escreve a migração.
//   Escopo   — schema `public`. Objeto de outro schema não entra na extração,
//              então não é aprovado por este arquivo — é ignorado por ele.
//   Vermelho — provado com SQL sintético em
//              tests/unit/gate-migracoes-isolamento.test.ts.
//
// POR QUE A LISTA DE EXCEÇÕES EXISTE, E POR QUE ELA NASCE VAZIA:
// gate sem porta de saída vira gate que alguém apaga no dia em que ele atrapalha.
// A porta aqui é a mesma de tests/gate/postgres.ts: a isenção é um objeto com
// motivo escrito e com o que exige removê-la, e ela ENVELHECE MAL DE PROPÓSITO
// — no instante em que o objeto passa a cumprir a regra, a isenção vira queixa
// e precisa sair. Declaração que sobrevive ao fato é pior que regra violada,
// porque faz o leitor confiar num texto que já não descreve o arquivo.
//
// Hoje a lista está vazia porque as 11 tabelas, as 5 declarações de view e as
// 23 policies do disco cumprem as três regras. Vazia é o estado correto: uma
// isenção inventada para "exercitar o mecanismo" seria exatamente o folclore
// que o parágrafo acima existe para impedir.
import {
  chaveDaView,
  queixasDeView,
  type Objetos,
  type Policy,
  type View,
} from "./migracoes.ts";

/** Uma queixa, com a chave que a lista de exceções sabe casar. */
export interface Queixa {
  /** `view:public.vw_x`, `tabela:public.t` ou `policy:nome@public.t`. */
  readonly chave: string;
  readonly texto: string;
}

/**
 * Uma isenção declarada.
 *
 * `chave` é a mesma string que a queixa carrega — casar por chave, e não por
 * nome solto, é o que impede uma isenção de view silenciar uma tabela homônima.
 */
export interface ExcecaoIsolamento {
  readonly chave: string;
  readonly motivo: string;
  readonly oQueExigeRemover: string;
}

/**
 * As isenções aceitas hoje. Vazia, e é para ficar vazia enquanto não houver
 * uma real — ver o cabeçalho.
 */
export const EXCECOES_ISOLAMENTO: readonly ExcecaoIsolamento[] = [];

// ------------------------------------------------------------------- as chaves

export function chaveDaTabela(nome: string): string {
  return `tabela:${nome}`;
}

export function chaveDaPolicy(nome: string, tabela: string): string {
  return `policy:${nome}@${tabela}`;
}

// -------------------------------------------------- regra (b): tabela com RLS

/**
 * Uma queixa por tabela de `public` que nenhuma migração habilita RLS.
 *
 * O casamento é por nome, não por arquivo: habilitar na migração seguinte é
 * legítimo e comum neste schema. O que o gate cobra é que ALGUMA migração
 * habilite — tabela sem RLS num banco com PostgREST na frente é leitura aberta
 * para qualquer usuário autenticado, não só para o dono da linha.
 *
 * O event trigger `rls_auto_enable` da 0027 NÃO conta como habilitação. Ele
 * roda no banco, não no texto, engole a própria falha num `EXCEPTION WHEN
 * OTHERS` que só escreve RAISE LOG, e o comentário da própria migração o chama
 * de rede de segurança. Rede de segurança não é o contrato — se ela virasse
 * aprovação aqui, este gate nunca reprovaria tabela nenhuma.
 */
export function queixasDeTabela(objetos: Pick<Objetos, "tabelas" | "rls">): Queixa[] {
  const habilitadas = new Set(objetos.rls.map((r) => r.tabela));

  return objetos.tabelas
    .filter((t) => !habilitadas.has(t.nome))
    .map((t) => ({
      chave: chaveDaTabela(t.nome),
      texto:
        `${t.nome} (${t.arquivo}:${t.linha}) é criada em public e nenhuma migração ` +
        `roda \`alter table ${t.nome} enable row level security\`. Sem RLS, toda ` +
        `linha da tabela fica legível para qualquer usuário autenticado — o ` +
        `event trigger rls_auto_enable da 0027 é rede de segurança, não o contrato.`,
    }));
}

// ------------------------------------------------ regra (c): policy com uid

/** `auth.uid()` com o espaçamento que o Postgres aceita. */
const RE_AUTH_UID = /\bauth\s*\.\s*uid\s*\(\s*\)/i;

/**
 * Uma queixa por policy cujo corpo não cita `auth.uid()`.
 *
 * Citar não é filtrar — `using (auth.uid() is not null)` passaria aqui e não
 * isola ninguém. O gate mede o piso, e o piso é o que dá para medir em texto:
 * policy que não menciona o usuário da sessão com certeza não filtra por ele.
 * O andar de cima é o job `sql`, que roda os asserts contra Postgres real.
 */
export function queixasDePolicy(policies: readonly Policy[]): Queixa[] {
  return policies
    .filter((p) => !RE_AUTH_UID.test(p.corpo))
    .map((p) => ({
      chave: chaveDaPolicy(p.nome, p.tabela),
      texto:
        `a policy ${p.nome} em ${p.tabela} (${p.arquivo}:${p.linha}) não cita ` +
        `auth.uid() no corpo. Policy que não menciona o usuário da sessão não ` +
        `filtra por ele: ela vira um "for select using (true)" com nome de ` +
        `segurança.`,
    }));
}

// ------------------------------------------------------- as queixas sem isenção

/** As três regras aplicadas, antes de qualquer isenção. */
export function queixasCruas(objetos: Objetos): Queixa[] {
  // Uma view por vez para saber QUAL delas gerou a queixa — a regra continua
  // sendo a de migracoes.ts, sem uma segunda cópia dela aqui.
  const deViews = objetos.views.reduce<Queixa[]>(
    (acc, v: View) =>
      acc.concat(
        queixasDeView([v]).map((texto) => ({ chave: chaveDaView(v.nome), texto })),
      ),
    [],
  );

  return deViews.concat(queixasDeTabela(objetos), queixasDePolicy(objetos.policies));
}

// ------------------------------------------------- regra (d): declaração órfã

/** Toda chave que existe no disco, cumprindo a regra ou não. */
function chavesConhecidas(objetos: Objetos): Set<string> {
  const chaves = new Set<string>();
  for (const v of objetos.views) chaves.add(chaveDaView(v.nome));
  for (const t of objetos.tabelas) chaves.add(chaveDaTabela(t.nome));
  for (const p of objetos.policies) chaves.add(chaveDaPolicy(p.nome, p.tabela));
  return chaves;
}

/**
 * Uma queixa por isenção que não isenta nada.
 *
 * Dois casos, e a mensagem separa os dois porque o conserto é diferente: o
 * objeto passou a cumprir a regra (apague a isenção) ou o objeto sumiu das
 * migrações (a isenção fala de um fantasma).
 */
export function queixasOrfas(
  excecoes: readonly ExcecaoIsolamento[],
  cruas: readonly Queixa[],
  objetos: Objetos,
): string[] {
  const comQueixa = new Set(cruas.map((q) => q.chave));
  const existentes = chavesConhecidas(objetos);

  return excecoes
    .filter((e) => !comQueixa.has(e.chave))
    .map((e) =>
      existentes.has(e.chave)
        ? `a exceção declarada para ${e.chave} é órfã: o objeto já cumpre a regra. ` +
          `Apague a declaração — isenção que sobrevive ao fato vira folclore, e o ` +
          `próximo leitor acredita nela.`
        : `a exceção declarada para ${e.chave} aponta para um objeto que nenhuma ` +
          `migração cria. Ou o nome está errado, ou o objeto foi removido e a ` +
          `isenção ficou para trás.`,
    );
}

// ------------------------------------------------------------------ o veredito

/**
 * Todas as queixas: as três regras menos o que está isento, mais as órfãs.
 *
 * Lista vazia é o único estado aprovado. A ordem é estável (views, tabelas,
 * policies, órfãs) para que a mensagem de falha não mude de forma entre duas
 * execuções idênticas.
 */
export function queixasDeIsolamento(
  objetos: Objetos,
  excecoes: readonly ExcecaoIsolamento[] = EXCECOES_ISOLAMENTO,
): string[] {
  const cruas = queixasCruas(objetos);
  const isentas = new Set(excecoes.map((e) => e.chave));

  return cruas
    .filter((q) => !isentas.has(q.chave))
    .map((q) => q.texto)
    .concat(queixasOrfas(excecoes, cruas, objetos));
}
