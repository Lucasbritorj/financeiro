import { test } from "node:test";
import assert from "node:assert/strict";
import { dependeDoAmbiente, lerAsserts, lerShim, type Shim } from "./_asserts-sql.ts";

// CONTRATO
//   Garante  — que todo assert de supabase/tests que depende do ambiente tem,
//              em tests/sql/00_shim_auth.sql, o que esse contrato exige.
//   Falha se — existir assert lendo `app.test_user_id` ou caindo no fallback
//              `order by created_at` enquanto o shim não criar auth.users, não
//              tiver created_at, ou não inserir usuário de fixture.
//   Espelha  — o contrato de setup do shim, não um comando: é a condição para
//              o grupo 2 rodar contra Postgres limpo em tests/sql/run_local.sh.
//   Vermelho — provado com Shim sintético incompleto nos testes de faltasDoShim.
//
// Os asserts de supabase/tests se dividem em dois contratos de setup:
//
//   grupo 1 — criam o próprio usuário dentro da transação (ids ...aa, ...bb,
//             ...cf). Rodam contra Postgres limpo sem ajuda nenhuma.
//   grupo 2 — leem `app.test_user_id` e, na falta, caem em
//             `select id from auth.users order by created_at limit 1`.
//             Nasceram rodando contra o projeto Supabase real, onde sempre há
//             usuário; contra Postgres limpo abortam em "shim de auth não
//             configurado".
//
// O grupo 2 só roda se tests/sql/00_shim_auth.sql provisionar a coluna pela
// qual o fallback ordena e um usuário commitado para ele encontrar. Isso já
// custou uma sessão de diagnóstico: quatro asserts pareciam ter lógica
// quebrada e nenhum tinha — o defeito era do shim. Nada verificava o
// pareamento, e este teste existe para que passe a verificar.

/** As peças que o contrato do grupo 2 exige do shim, e que faltam hoje. */
function faltasDoShim(shim: Shim): string[] {
  const faltas: string[] = [];

  if (!shim.criaAuthUsers) faltas.push("a tabela auth.users");
  // Sem created_at o fallback `order by created_at` nem compila.
  if (!shim.temCreatedAt) faltas.push("a coluna created_at em auth.users");
  // Com a tabela vazia o fallback devolve null e o assert aborta em
  // "shim de auth não configurado" — que lê como teste quebrado, não como
  // ambiente incompleto.
  if (!shim.insereFixture) faltas.push("um usuário de fixture commitado");

  return faltas;
}

// O gate só vale se souber falhar. Sem estes casos, um erro em faltasDoShim
// deixaria o teste verde para sempre.
test("faltasDoShim: shim sem a coluna created_at é violação", () => {
  const shim: Shim = { criaAuthUsers: true, temCreatedAt: false, insereFixture: true };

  assert.deepEqual(faltasDoShim(shim), ["a coluna created_at em auth.users"]);
});

test("faltasDoShim: shim sem usuário de fixture é violação", () => {
  const shim: Shim = { criaAuthUsers: true, temCreatedAt: true, insereFixture: false };

  assert.deepEqual(faltasDoShim(shim), ["um usuário de fixture commitado"]);
});

test("faltasDoShim: shim que não cria a tabela acusa as três faltas de uma vez", () => {
  const shim: Shim = { criaAuthUsers: false, temCreatedAt: false, insereFixture: false };

  assert.equal(faltasDoShim(shim).length, 3);
});

test("faltasDoShim: shim completo não cobra nada", () => {
  const shim: Shim = { criaAuthUsers: true, temCreatedAt: true, insereFixture: true };

  assert.deepEqual(faltasDoShim(shim), []);
});

test("dependeDoAmbiente: assert self-contained não cobra nada do shim", () => {
  const grupo1 = [
    "insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000aa', 'a@b.c');",
    "perform set_config('request.jwt.claims', json_build_object('sub', v_uid)::text, true);",
  ].join("\n");

  assert.equal(dependeDoAmbiente(grupo1), false);
});

test("suíte real: todo assert que depende do ambiente tem o shim que o contrato exige", () => {
  // Vacuidade é resposta legítima aqui: se um dia nenhum assert depender do
  // ambiente, não há o que garantir. O que não pode acontecer é existir assert
  // do grupo 2 com o shim incompleto — que é o estado que já aconteceu.
  const dependentes = lerAsserts()
    .filter((item) => dependeDoAmbiente(item.codigo))
    .map((item) => item.arquivo);

  if (dependentes.length === 0) return;

  const faltas = faltasDoShim(lerShim());

  assert.deepEqual(
    faltas,
    [],
    `${dependentes.length} assert(s) de supabase/tests dependem do ambiente ` +
      `(${dependentes.join(", ")}) e tests/sql/00_shim_auth.sql não provisiona: ` +
      `${faltas.join(", ")}. Contra Postgres limpo eles abortam em "shim de auth não ` +
      `configurado", que lê como lógica quebrada quando o defeito é do ambiente. ` +
      `Complete o shim ou reescreva o assert como self-contained.`,
  );
});
