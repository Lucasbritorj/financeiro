import { test } from "node:test";
import assert from "node:assert/strict";
import { lerMigracoes, limparSql, linhaDe, normalizarNome } from "./_migracoes.ts";

// A 0022 executava `revoke execute on function public.rls_auto_enable()` e
// NENHUMA migração criava essa função — ela existia só no banco de produção,
// criada fora do controle de migrações. Resultado: a 0022 funcionava lá e só
// lá, e aplicar as migrações num Postgres limpo abortava com "function
// public.rls_auto_enable() does not exist".
//
// Foi achado à mão em 13/08/2026, depois de sobreviver a 5 migrações. Este
// gate é a versão executável do achado: referência a função sem criação
// correspondente para o CI, não a paciência de alguém.
//
// A ordem importa tanto quanto a existência. Trazer o objeto ausente numa
// migração POSTERIOR não resolve — a referência quebrada continua rodando
// primeiro. Por isso a comparação é por número de migração, não por presença.

interface Ocorrencia {
  chave: string;
  bruto: string;
  arquivo: string;
  numero: number;
  linha: number;
}

interface EntradaMigracao {
  numero: number;
  arquivo: string;
  sql: string;
}

/**
 * Chave de comparação. `public.foo` e `foo` são o mesmo objeto — `public` é o
 * schema padrão do projeto. Qualquer outro schema (`auth`, `extensions`,
 * `pg_catalog`) é objeto de fábrica do Postgres ou do Supabase: não é criado
 * por migração deste repositório e fica declaradamente fora do gate.
 */
function chaveDeFuncao(nome: string): string | null {
  const partes = normalizarNome(nome).split(".");
  if (partes.length === 1) return partes[0] || null;
  if (partes.length === 2 && partes[0] === "public") return partes[1] || null;
  return null;
}

/** Statement inteiro a partir de `inicio`. O corpo já veio em branco, então o
 *  primeiro `;` é mesmo o fim do comando e não um `;` de dentro da função. */
function statementEm(sql: string, inicio: number): string {
  const fim = sql.indexOf(";", inicio);
  return fim === -1 ? sql.slice(inicio) : sql.slice(inicio, fim + 1);
}

export function funcoesCriadas(migracoes: EntradaMigracao[]): Map<string, number> {
  const criadas = new Map<string, number>();
  for (const m of migracoes) {
    const re = /\bcreate\s+(?:or\s+replace\s+)?function\s+([^\s(]+)/gi;
    let achado: RegExpExecArray | null;
    while ((achado = re.exec(m.sql)) !== null) {
      const chave = chaveDeFuncao(achado[1]);
      if (chave === null) continue;
      // `create or replace` repetido: vale a primeira, que é quando o objeto
      // passa a existir.
      if (!criadas.has(chave) || criadas.get(chave)! > m.numero) {
        criadas.set(chave, m.numero);
      }
    }
  }
  return criadas;
}

export function referenciasAFuncao(migracoes: EntradaMigracao[]): Ocorrencia[] {
  const refs: Ocorrencia[] = [];

  const registrar = (m: EntradaMigracao, bruto: string, offset: number) => {
    const chave = chaveDeFuncao(bruto);
    if (chave === null) return;
    refs.push({
      chave,
      bruto,
      arquivo: m.arquivo,
      numero: m.numero,
      linha: linhaDe(m.sql, offset),
    });
  };

  for (const m of migracoes) {
    // revoke/grant/comment ... ON FUNCTION nome(assinatura)[, nome(assinatura)]
    // O `from public, anon` no fim não tem parêntese, então não vira nome.
    const reOn = /\bon\s+function\s+/gi;
    let achado: RegExpExecArray | null;
    while ((achado = reOn.exec(m.sql)) !== null) {
      const inicio = achado.index + achado[0].length;
      const trecho = statementEm(m.sql, inicio);
      const reNome = /([A-Za-z_"][\w".]*)\s*\(/g;
      let nome: RegExpExecArray | null;
      while ((nome = reNome.exec(trecho)) !== null) {
        registrar(m, nome[1], inicio + nome.index);
      }
    }

    // ALTER FUNCTION nome / DROP FUNCTION [IF EXISTS] nome
    const reAlter = /\b(?:alter|drop)\s+function\s+(?:if\s+exists\s+)?([^\s(]+)/gi;
    while ((achado = reAlter.exec(m.sql)) !== null) {
      registrar(m, achado[1], achado.index);
    }

    // CREATE TRIGGER ... EXECUTE FUNCTION nome() — trigger apontando para
    // função inexistente falha do mesmo jeito, na mesma hora.
    const reExec = /\bexecute\s+(?:function|procedure)\s+([^\s(]+)/gi;
    while ((achado = reExec.exec(m.sql)) !== null) {
      registrar(m, achado[1], achado.index);
    }
  }

  return refs;
}

export function violacoes(migracoes: EntradaMigracao[]): Ocorrencia[] {
  const criadas = funcoesCriadas(migracoes);
  return referenciasAFuncao(migracoes).filter((ref) => {
    const criadaEm = criadas.get(ref.chave);
    return criadaEm === undefined || criadaEm > ref.numero;
  });
}

function sintetica(numero: number, sql: string): EntradaMigracao {
  return {
    numero,
    arquivo: `${String(numero).padStart(4, "0")}_sintetica.sql`,
    sql: limparSql(sql),
  };
}

// O gate só vale se souber falhar. Sem estes casos, um erro na extração o
// deixaria verde para sempre — que é exatamente o modo de falha que ele existe
// para impedir.
test("detector: referência sem criação nenhuma é violação", () => {
  const achados = violacoes([
    sintetica(1, "create table t (id uuid);"),
    sintetica(2, "revoke execute on function public.fantasma() from public;"),
  ]);
  assert.equal(achados.length, 1);
  assert.equal(achados[0].chave, "fantasma");
  assert.equal(achados[0].numero, 2);
});

test("detector: criação em migração ANTERIOR é válida", () => {
  const achados = violacoes([
    sintetica(1, "create function public.f() returns void language sql as $$ select 1; $$;"),
    sintetica(2, "revoke execute on function public.f() from public;"),
  ]);
  assert.deepEqual(achados, []);
});

test("detector: criação na MESMA migração é válida", () => {
  const achados = violacoes([
    sintetica(1, "create function public.f() returns void language sql as $$ select 1; $$; revoke execute on function public.f() from public;"),
  ]);
  assert.deepEqual(achados, []);
});

test("detector: criação em migração POSTERIOR ainda é violação — foi o bug da 0022", () => {
  const achados = violacoes([
    sintetica(22, "revoke execute on function public.rls_auto_enable() from public;"),
    sintetica(27, "create function public.rls_auto_enable() returns event_trigger language plpgsql as $$ begin end; $$;"),
  ]);
  assert.equal(achados.length, 1, "trazer o objeto depois não conserta a ordem de aplicação");
  assert.equal(achados[0].chave, "rls_auto_enable");
});

test("detector: grant com várias funções no mesmo comando não escapa", () => {
  const achados = violacoes([
    sintetica(1, "create function public.a() returns void language sql as $$ select 1; $$;"),
    sintetica(2, "grant execute on function public.a(), public.b(uuid) to authenticated;"),
  ]);
  assert.equal(achados.length, 1);
  assert.equal(achados[0].chave, "b");
});

test("detector: trigger apontando para função inexistente é violação", () => {
  const achados = violacoes([
    sintetica(1, "create trigger t after insert on tab for each row execute function public.ausente();"),
  ]);
  assert.equal(achados.length, 1);
  assert.equal(achados[0].chave, "ausente");
});

test("detector: revoke guardado dentro de bloco DO não conta como referência estática", () => {
  // É a forma que a 0022 tem hoje: só revoga se a função existir. Guard é
  // justamente a saída legítima para objeto criado fora das migrações, e o
  // gate não pode punir quem usou a saída certa.
  const achados = violacoes([
    sintetica(22, "do $do$ begin execute 'revoke execute on function public.legado() from public'; end $do$;"),
  ]);
  assert.deepEqual(achados, []);
});

test("detector: schema fora de public fica declaradamente fora do gate", () => {
  const achados = violacoes([
    sintetica(1, "revoke execute on function auth.jwt() from public;"),
  ]);
  assert.deepEqual(achados, []);
});

test("migrações reais: nenhum revoke/grant/alter/trigger aponta para função não criada", () => {
  const achados = violacoes(lerMigracoes());
  assert.deepEqual(
    achados.map((v) => `${v.arquivo}:${v.linha} -> ${v.bruto}`),
    [],
    "referência a função que nenhuma migração cria antes deste ponto. Em banco " +
      "limpo isso aborta a aplicação com 'does not exist'. Ou crie o objeto numa " +
      "migração ANTERIOR, ou proteja a referência com guard de existência.",
  );
});
