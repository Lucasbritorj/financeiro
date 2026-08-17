import { test } from "node:test";
import assert from "node:assert/strict";
import {
  dependeDoAmbiente,
  lerAsserts,
  lerShim,
  noticesDeSucesso,
  semComentario,
} from "./_asserts-sql.ts";

// CONTRATO
//   Garante  — que as primitivas de _asserts-sql.ts leem SQL como o restante
//              dos gates supõe: comentário sai, literal sobrevive.
//   Falha se — comentário virar código (ou o contrário), dependeDoAmbiente
//              deixar de reconhecer as duas marcas do grupo 2, ou
//              noticesDeSucesso parar de extrair o literal de `raise notice`.
//   Espelha  — nenhuma regra de produção direto: é a base de que os gates
//              asserts-sql-contrato e asserts-sql-notice dependem.
//   Vermelho — provado com entrada sintética em todos os casos abaixo.
//
// Os gates que vêm depois só valem o que este parser valer. Um erro aqui não
// deixa um gate vermelho — deixa os três verdes para sempre, medindo nada.
// Por isso o parser é testado com entrada sintética antes de qualquer assert
// contra os arquivos reais.

test("semComentario: comentário de linha some, código sobrevive", () => {
  const entrada = ["select 1; -- isto é comentário", "select 2;"].join("\n");
  const saida = semComentario(entrada);

  assert.match(saida, /select 1;/);
  assert.match(saida, /select 2;/);
  assert.doesNotMatch(saida, /comentário/);
});

test("semComentario: comentário de bloco some, inclusive atravessando linhas", () => {
  const entrada = "select 1; /* nota\n em duas linhas */ select 2;";
  const saida = semComentario(entrada);

  assert.doesNotMatch(saida, /nota/);
  assert.doesNotMatch(saida, /duas linhas/);
  assert.match(saida, /select 2;/);
});

test("semComentario: literal com dois hifens não é comentário", () => {
  const saida = semComentario("select 'valor -- ainda dado' as x;");

  assert.match(saida, /valor -- ainda dado/);
});

test("semComentario: apóstrofo dentro de comentário não abre string falsa", () => {
  // Sem tratar comentário primeiro, o apóstrofo de "não persiste'" abriria uma
  // string que engoliria o resto do arquivo — e um arquivo sem notice nenhum
  // passaria a parecer que tem, ou vice-versa.
  const entrada = ["-- não persiste' nada aqui", "raise notice 'OK: 1/1 asserts';"].join("\n");

  assert.deepEqual(noticesDeSucesso(semComentario(entrada)), ["OK: 1/1 asserts"]);
});

test("semComentario: aspa dobrada é dado, não fim de string", () => {
  const saida = semComentario("select 'a''b -- c' as x;");

  assert.match(saida, /a''b -- c/);
});

test("semComentario: corpo de dollar-quote continua sendo analisado", () => {
  // O corpo de $teste$ é código PL/pgSQL: comentário lá dentro é comentário de
  // verdade. Tratar o bloco como string opaca esconderia o que se quer olhar.
  const entrada = ["do $teste$", "begin", "  -- some", "end", "$teste$;"].join("\n");

  assert.doesNotMatch(semComentario(entrada), /some/);
});

test("dependeDoAmbiente: reconhece as duas marcas do grupo 2, e só elas", () => {
  assert.equal(
    dependeDoAmbiente("v_uid uuid := current_setting('app.test_user_id', true)::uuid;"),
    true,
  );
  assert.equal(
    dependeDoAmbiente("v_uid := (select id from auth.users order by created_at limit 1);"),
    true,
  );
  // Grupo 1: cria o próprio usuário dentro da transação.
  assert.equal(
    dependeDoAmbiente("insert into auth.users (id) values ('...aa') returning id;"),
    false,
  );
  assert.equal(dependeDoAmbiente("select current_setting('request.jwt.claims', true);"), false);
});

test("noticesDeSucesso: pega o literal, não a chamada inteira", () => {
  const codigo = "raise notice 'OK: todos os asserts passaram >>> %', log;";

  assert.deepEqual(noticesDeSucesso(codigo), ["OK: todos os asserts passaram >>> %"]);
});

test("noticesDeSucesso: vários notices no mesmo arquivo, e nenhum é notice", () => {
  const codigo = ["raise notice 'primeiro';", "raise notice 'segundo';"].join("\n");

  assert.deepEqual(noticesDeSucesso(codigo), ["primeiro", "segundo"]);
  assert.deepEqual(noticesDeSucesso("raise exception 'não é notice';"), []);
});

test("lerAsserts: enxerga a suíte real, e nenhum arquivo entra vazio", () => {
  const asserts = lerAsserts();

  assert.ok(
    asserts.length > 0,
    "nenhum .sql encontrado em supabase/tests — path errado ou glob quebrado, " +
      "não suíte vazia. O gate inteiro seria vacuamente verde.",
  );
  for (const item of asserts) {
    assert.ok(item.codigo.trim().length > 0, `${item.arquivo} ficou vazio após remover comentário`);
  }
});

test("lerShim: lê o que o shim real provisiona", () => {
  const shim = lerShim();

  // Sem a tabela não há contrato nenhum a discutir: é o piso do arquivo.
  assert.equal(shim.criaAuthUsers, true, "tests/sql/00_shim_auth.sql não cria auth.users");
});
