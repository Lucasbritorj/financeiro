import { test } from "node:test";
import assert from "node:assert/strict";
import {
  lerMigracoes,
  limparSql,
  linhaDe,
  normalizarNome,
} from "./_migracoes.ts";

// Os três gates de migração (referência, view-invoker, search-path) só valem o
// que `limparSql` valer: se o corpo de uma função vazar para a análise, um
// `create view` de exemplo dentro de um comentário vira achado, e um gate que
// grita errado é desligado na primeira semana. Estes casos existem para que a
// limpeza falhe aqui, em entrada sintética, e não lá, em achado fantasma.

test("limparSql: apaga comentário de linha e preserva o resto", () => {
  const limpo = limparSql("select 1; -- create view falsa\nselect 2;");
  assert.match(limpo, /select 1;/);
  assert.match(limpo, /select 2;/);
  assert.doesNotMatch(limpo, /create view/);
});

test("limparSql: apaga comentário de bloco, inclusive aninhado", () => {
  const limpo = limparSql("a /* fora /* dentro */ ainda fora */ b");
  assert.match(limpo, /^a\s+b$/);
});

test("limparSql: apaga o corpo dollar-quoted e mantém os delimitadores", () => {
  const sql = "create function f() returns void as $$ create view vazada as select 1; $$;";
  const limpo = limparSql(sql);
  assert.doesNotMatch(limpo, /create view/);
  assert.equal((limpo.match(/\$\$/g) ?? []).length, 2);
  assert.match(limpo, /create function f\(\) returns void as \$\$/);
});

test("limparSql: reconhece delimitador com tag", () => {
  const limpo = limparSql("as $corpo$ create view vazada as select 1; $corpo$;");
  assert.doesNotMatch(limpo, /create view/);
  assert.match(limpo, /\$corpo\$/);
});

test("limparSql: $1 é parâmetro posicional, não delimitador", () => {
  const sql = "select * from t where id = $1 and nome = $2;";
  assert.equal(limparSql(sql), sql);
});

test("limparSql: apaga conteúdo de string e trata aspa escapada", () => {
  const limpo = limparSql("raise exception 'create view '' interna' using errcode = 'FW400';");
  assert.doesNotMatch(limpo, /create view/);
  assert.doesNotMatch(limpo, /FW400/);
  assert.match(limpo, /raise exception/);
  assert.match(limpo, /using errcode =/);
});

test("limparSql: preserva a contagem de linhas e o comprimento", () => {
  const sql = "a\n-- comentário\n/* bloco\nem duas linhas */\nas $$\ncorpo\n$$;\n";
  const limpo = limparSql(sql);
  assert.equal(limpo.length, sql.length);
  assert.equal(limpo.split("\n").length, sql.split("\n").length);
});

test("limparSql: dollar-quote sem fechamento não engole silenciosamente o resto", () => {
  // Arquivo truncado é erro de conteúdo, não de parser — o que importa é que a
  // limpeza termine em vez de estourar.
  const limpo = limparSql("as $$ corpo sem fim");
  assert.match(limpo, /as \$\$/);
  assert.doesNotMatch(limpo, /corpo/);
});

test("linhaDe: conta a partir de 1", () => {
  const sql = "um\ndois\ntres";
  assert.equal(linhaDe(sql, 0), 1);
  assert.equal(linhaDe(sql, sql.indexOf("dois")), 2);
  assert.equal(linhaDe(sql, sql.indexOf("tres")), 3);
});

test("normalizarNome: aspas e caixa não criam nomes diferentes", () => {
  assert.equal(normalizarNome('"public"."Foo"'), "public.foo");
  assert.equal(normalizarNome("public.foo"), "public.foo");
  assert.equal(normalizarNome("  PUBLIC . FOO "), "public.foo");
});

test("lerMigracoes: lê as migrações reais em ordem estritamente crescente", () => {
  const migracoes = lerMigracoes();
  assert.ok(migracoes.length > 0, "nenhuma migração encontrada em supabase/migrations");

  for (let i = 1; i < migracoes.length; i++) {
    assert.ok(
      migracoes[i].numero > migracoes[i - 1].numero,
      `prefixo repetido ou fora de ordem entre ${migracoes[i - 1].arquivo} e ` +
        `${migracoes[i].arquivo} — a ordem de aplicação fica ambígua.`,
    );
  }
});

test("lerMigracoes: o SQL limpo não perde o SQL de nível superior", () => {
  const migracoes = lerMigracoes();
  const nucleo = migracoes.find((m) => m.numero === 1);
  assert.ok(nucleo, "0001 não encontrada");
  assert.match(nucleo.sql, /create table/i);
  assert.equal(nucleo.sql.length, nucleo.bruto.length);
});
