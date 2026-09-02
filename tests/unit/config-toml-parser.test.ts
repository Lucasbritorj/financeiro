import { test } from "node:test";
import assert from "node:assert/strict";
import { lerSecaoToml, ERRO, type ValorToml } from "./_config-toml.ts";

// O cabeçalho de _config-toml.ts promete "Vermelho — provado com TOML sintético no
// teste que usa este módulo". Não era verdade: supabase-auth-config.test.ts só lê o
// config.toml real e válido, então nenhum dos cinco `falhar()` do parser era
// exercitado. Um parser que "RECUSA o resto em voz alta" sem teste que prove a
// recusa é promessa, não garantia — e este arquivo existe para transformar uma na
// outra. Os casos abaixo cobrem os cinco caminhos de erro e as conversões.

const seErro = (fn: () => unknown, trecho: string) =>
  assert.throws(fn, (e: Error) => {
    assert.ok(e.message.startsWith(ERRO), `mensagem não usa o prefixo padrão: ${e.message}`);
    assert.ok(
      e.message.includes(trecho),
      `mensagem não explica a causa (esperava conter "${trecho}"): ${e.message}`,
    );
    return true;
  });

test("verde: lê chaves de topo da seção e para na próxima", () => {
  const toml = `[auth]
enable_signup = true
minimum_password_length = 8

[auth.email]
enable_confirmations = false`;
  assert.deepEqual(lerSecaoToml(toml, "auth"), {
    enable_signup: true,
    minimum_password_length: 8,
  });
  assert.deepEqual(lerSecaoToml(toml, "auth.email"), { enable_confirmations: false });
});

test("verde: string, número negativo, decimal, array de strings e array vazio", () => {
  const toml = `[x]
nome = "atelie"
negativo = -5
decimal = 1.5
lista = ["a", "b"]
vazio = []`;
  const x = lerSecaoToml(toml, "x") as Record<string, ValorToml>;
  assert.equal(x.nome, "atelie");
  assert.equal(x.negativo, -5);
  assert.equal(x.decimal, 1.5);
  assert.deepEqual(x.lista, ["a", "b"]);
  assert.deepEqual(x.vazio, []);
});

test("verde: comentário e linha em branco não viram chave", () => {
  const toml = `[x]
# isto é comentário
a = 1

b = 2`;
  assert.deepEqual(lerSecaoToml(toml, "x"), { a: 1, b: 2 });
});

test("vermelho: seção inexistente é recusada pelo nome", () => {
  seErro(() => lerSecaoToml("[auth]\na = 1", "storage"), "[storage]");
});

test("vermelho: linha que não é `chave = valor` é recusada", () => {
  seErro(() => lerSecaoToml("[x]\nisto nao tem igual", "x"), "não é `chave = valor`");
});

test("vermelho: seção existente mas vazia é recusada, não devolve {}", () => {
  // O modo de falha que isto protege: config.toml muda de forma, a seção fica
  // vazia, e um `{}` silencioso faria os asserts do checklist passarem por vácuo.
  seErro(() => lerSecaoToml("[auth]\n\n[outra]\na = 1", "auth"), "não tem nenhuma chave");
});

test("vermelho: valor não reconhecido é recusado (string sem aspas)", () => {
  seErro(() => lerSecaoToml("[x]\na = sem_aspas", "x"), "valor não reconhecido");
});

test("vermelho: array com item não-string é recusado", () => {
  seErro(() => lerSecaoToml("[x]\na = [1, 2]", "x"), "array com item não-string");
});

test("vermelho: o parser não entende tabela inline — e diz isso", () => {
  // Está no CONTRATO como "não faz". O teste garante que vira erro alto, e não
  // uma leitura silenciosamente errada.
  seErro(() => lerSecaoToml("[x]\na = { b = 1 }", "x"), "valor não reconhecido");
});
