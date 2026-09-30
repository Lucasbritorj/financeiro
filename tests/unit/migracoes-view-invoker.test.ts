import { test } from "node:test";
import assert from "node:assert/strict";
import { lerMigracoes, limparSql, linhaDe } from "./_migracoes.ts";

// O CLAUDE.md deste projeto diz, sobre view nova: "security_invoker = true —
// obrigatório em toda view nova, senão a view roda com privilégio do dono e
// vaza dados entre usuários".
//
// Hoje isso é prosa num arquivo de instrução, reforçada por comentário dentro
// das migrações. Prosa não roda no CI, e o modo de falha é silencioso: a view
// sem invoker funciona perfeitamente em teste com um usuário só, e passa a
// devolver linha de outro usuário em produção. Não quebra — vaza.
//
// Este gate torna a regra executável. Escopo: view comum. Materialized view
// não aceita security_invoker e é tratada à parte, em vez de ser ignorada em
// silêncio, que seria um buraco de cobertura com cara de aprovação.

interface Ocorrencia {
  nome: string;
  arquivo: string;
  linha: number;
}

interface EntradaMigracao {
  numero: number;
  arquivo: string;
  sql: string;
}

/** Statement inteiro a partir de `inicio` — o corpo já veio em branco. */
function statementEm(sql: string, inicio: number): string {
  const fim = sql.indexOf(";", inicio);
  return fim === -1 ? sql.slice(inicio) : sql.slice(inicio, fim + 1);
}

export function viewsSemInvoker(migracoes: EntradaMigracao[]): Ocorrencia[] {
  const achados: Ocorrencia[] = [];

  for (const m of migracoes) {
    const re = /\bcreate\s+(?:or\s+replace\s+)?view\s+([^\s(]+)/gi;
    let achado: RegExpExecArray | null;
    while ((achado = re.exec(m.sql)) !== null) {
      const statement = statementEm(m.sql, achado.index);
      // A cláusula `with (...)` vive entre o nome e o `as` que abre a query.
      const corte = statement.search(/\bas\b/i);
      const cabecalho = corte === -1 ? statement : statement.slice(0, corte);

      if (!/security_invoker\s*=\s*true/i.test(cabecalho)) {
        achados.push({
          nome: achado[1],
          arquivo: m.arquivo,
          linha: linhaDe(m.sql, achado.index),
        });
      }
    }
  }

  return achados;
}

export function materializedViews(migracoes: EntradaMigracao[]): Ocorrencia[] {
  const achados: Ocorrencia[] = [];
  for (const m of migracoes) {
    const re = /\bcreate\s+(?:or\s+replace\s+)?materialized\s+view\s+(?:if\s+not\s+exists\s+)?([^\s(]+)/gi;
    let achado: RegExpExecArray | null;
    while ((achado = re.exec(m.sql)) !== null) {
      achados.push({
        nome: achado[1],
        arquivo: m.arquivo,
        linha: linhaDe(m.sql, achado.index),
      });
    }
  }
  return achados;
}

function sintetica(numero: number, sql: string): EntradaMigracao {
  return {
    numero,
    arquivo: `${String(numero).padStart(4, "0")}_sintetica.sql`,
    sql: limparSql(sql),
  };
}

test("detector: view sem cláusula with é violação", () => {
  const achados = viewsSemInvoker([
    sintetica(1, "create view public.vw_vazada as select * from t;"),
  ]);
  assert.equal(achados.length, 1);
  assert.equal(achados[0].nome, "public.vw_vazada");
});

test("detector: view com security_invoker = true passa", () => {
  const achados = viewsSemInvoker([
    sintetica(1, "create or replace view public.vw_ok with (security_invoker = true) as select * from t;"),
  ]);
  assert.deepEqual(achados, []);
});

test("detector: with (...) que não é security_invoker não vale como invoker", () => {
  const achados = viewsSemInvoker([
    sintetica(1, "create view public.vw_x with (check_option = local) as select * from t;"),
  ]);
  assert.equal(achados.length, 1);
});

test("detector: security_invoker = false é violação, não aprovação por menção", () => {
  const achados = viewsSemInvoker([
    sintetica(1, "create view public.vw_y with (security_invoker = false) as select * from t;"),
  ]);
  assert.equal(achados.length, 1);
});

test("detector: security_invoker citado só no corpo da query não conta", () => {
  // O cabeçalho é o que o Postgres lê. Menção depois do `as` é texto.
  const achados = viewsSemInvoker([
    sintetica(1, "create view public.vw_z as select 'security_invoker = true' as nota;"),
  ]);
  assert.equal(achados.length, 1);
});

test("detector: view mencionada em comentário não vira achado", () => {
  const achados = viewsSemInvoker([
    sintetica(1, "-- create view public.exemplo as select 1;\nselect 1;"),
  ]);
  assert.deepEqual(achados, []);
});

test("migrações reais: toda view declara security_invoker = true", () => {
  const achados = viewsSemInvoker(lerMigracoes());
  assert.deepEqual(
    achados.map((v) => `${v.arquivo}:${v.linha} -> ${v.nome}`),
    [],
    "view sem security_invoker = true roda com o privilégio do dono e ignora a " +
      "RLS de quem consulta — vazamento de dado entre usuários, silencioso em " +
      "teste com um usuário só. Adicione with (security_invoker = true).",
  );
});

test("migrações reais: nenhuma materialized view — este gate não cobre esse caso", () => {
  const achados = materializedViews(lerMigracoes());
  assert.deepEqual(
    achados.map((v) => `${v.arquivo}:${v.linha} -> ${v.nome}`),
    [],
    "materialized view não aceita security_invoker: ela roda sempre com o " +
      "privilégio do dono. Se este assert quebrou, alguém criou uma — decida a " +
      "proteção de acesso explicitamente e estenda este gate. Falhar aqui é " +
      "melhor que fingir cobertura.",
  );
});
