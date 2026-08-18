import { test } from "node:test";
import assert from "node:assert/strict";
import { extrairObjetos, lerMigracoes, objetosDe } from "../gate/migracoes.ts";
import {
  EXCECOES_ISOLAMENTO,
  chaveDaPolicy,
  chaveDaTabela,
  queixasCruas,
  queixasDeIsolamento,
  queixasDePolicy,
  queixasDeTabela,
  queixasOrfas,
  type ExcecaoIsolamento,
} from "../gate/isolamento.ts";

// CONTRATO
//   Garante  — que as migrações deste projeto pedem isolamento por usuário nas
//              três formas que o CLAUDE.md declara: view com security_invoker,
//              tabela com RLS, policy citando auth.uid(). E que a lista de
//              isenções de tests/gate/isolamento.ts não guarda declaração órfã.
//   Falha se — qualquer um dos três for violado por um objeto de public, ou uma
//              isenção sobreviver ao fato que a justificava.
//   Espelha  — o TEXTO das migrações, não o schema real. Uma tabela criada à
//              mão no banco não aparece aqui, e uma policy que CITA auth.uid()
//              sem filtrar por ele passa: o piso é o que dá para medir em
//              texto. Quem mede o andar de cima é o job `sql` do CI.
//   Vermelho — provado com SQL sintético inline em cada uma das quatro regras.
//
// Como no gate das views, a contagem é impressa e assertada: as três regras
// já são cumpridas pelo disco de hoje, então o gate nasce verde, e um verde
// que não leu nada é indistinguível de um verde que leu tudo.

const ESPERADO = { tabelas: 11, views: 5, policies: 23, rls: 11 } as const;

// ---------------------------------------------------------------- o gate real

test("suíte real: as migrações do disco não têm queixa de isolamento nenhuma", () => {
  const objetos = extrairObjetos(lerMigracoes());

  console.log(
    `   conferidos: ${objetos.tabelas.length} tabelas contra ${objetos.rls.length} ` +
      `habilitações de RLS, ${objetos.views.length} declarações de view, ` +
      `${objetos.policies.length} policies, ${EXCECOES_ISOLAMENTO.length} isenções ` +
      `declaradas`,
  );

  assert.equal(objetos.tabelas.length, ESPERADO.tabelas);
  assert.equal(objetos.views.length, ESPERADO.views);
  assert.equal(objetos.policies.length, ESPERADO.policies);
  assert.equal(objetos.rls.length, ESPERADO.rls);

  assert.deepEqual(
    queixasDeIsolamento(objetos),
    [],
    "o isolamento por usuário saiu de sincronia com o que o CLAUDE.md promete.",
  );
});

test("suíte real: as 11 tabelas de public têm RLS habilitada por migração, não por trigger", () => {
  const objetos = extrairObjetos(lerMigracoes());

  assert.deepEqual(queixasDeTabela(objetos), []);
  assert.deepEqual(
    objetos.tabelas.map((t) => t.nome).filter((n) => !objetos.rls.some((r) => r.tabela === n)),
    [],
  );
});

test("suíte real: as 23 policies citam auth.uid()", () => {
  const objetos = extrairObjetos(lerMigracoes());

  assert.deepEqual(queixasDePolicy(objetos.policies), []);
});

test("suíte real: a lista de isenções está vazia, e vazia é o estado correto", () => {
  // Se algum dia deixar de estar, cada isenção precisa carregar motivo de
  // verdade e a saída — os mesmos dois campos que tests/gate/postgres.ts cobra
  // da DIVERGENCIA_DECLARADA. Hoje o laço é vazio, e é isso que a primeira
  // asserção registra: o teste abaixo não está passando por omissão.
  assert.equal(EXCECOES_ISOLAMENTO.length, 0);

  for (const excecao of EXCECOES_ISOLAMENTO) {
    assert.ok(
      excecao.motivo.length > 80,
      `isenção ${excecao.chave}: motivo curto demais para ser um motivo — é uma etiqueta`,
    );
    assert.ok(
      excecao.oQueExigeRemover.length > 40,
      `isenção ${excecao.chave}: não diz o que exige removê-la`,
    );
  }
});

test("suíte real: nenhuma isenção declarada é órfã", () => {
  const objetos = extrairObjetos(lerMigracoes());

  assert.deepEqual(queixasOrfas(EXCECOES_ISOLAMENTO, queixasCruas(objetos), objetos), []);
});

// ------------------------------------------------ regra (b): tabela sem RLS, RED

test("RED: tabela de public sem enable row level security é 1 queixa, com o nome", () => {
  const objetos = objetosDe("create table public.esquecida (id uuid primary key);");

  const queixas = queixasDeIsolamento(objetos);

  assert.equal(queixas.length, 1);
  assert.match(queixas[0], /public\.esquecida/);
  assert.match(queixas[0], /enable row level security/);
});

test("a habilitação pode vir em outra migração — o casamento é por nome", () => {
  const objetos = extrairObjetos([
    { arquivo: "a.sql", bruto: "", codigo: "create table public.t (id int);" },
    { arquivo: "b.sql", bruto: "", codigo: "alter table public.t enable row level security;" },
  ]);

  assert.deepEqual(queixasDeTabela(objetos), []);
});

test("RED: o rls_auto_enable da 0027 não aprova tabela — ele mora dentro de literal", () => {
  const objetos = objetosDe(
    "create table public.confiante (id int);\n" +
      "execute format('alter table %s enable row level security', 'public.confiante');",
  );

  assert.equal(queixasDeTabela(objetos).length, 1);
  assert.match(queixasDeTabela(objetos)[0].texto, /public\.confiante/);
});

// -------------------------------------------- regra (c): policy sem uid, RED

test("RED: policy que não cita auth.uid() é 1 queixa, com o nome e a tabela", () => {
  const objetos = objetosDe(
    "create table public.t (id int);\n" +
      "alter table public.t enable row level security;\n" +
      "create policy t_todos on public.t for select using (true);",
  );

  const queixas = queixasDeIsolamento(objetos);

  assert.equal(queixas.length, 1);
  assert.match(queixas[0], /t_todos/);
  assert.match(queixas[0], /public\.t/);
  assert.match(queixas[0], /auth\.uid\(\)/);
});

test("policy que cita auth.uid() passa, inclusive na forma (select auth.uid())", () => {
  const comum = objetosDe(
    "create policy p on public.t for select using ((select auth.uid()) = user_id);",
  );
  const espacada = objetosDe("create policy p on public.t for select using (auth . uid ( ) = u);");

  assert.deepEqual(queixasDePolicy(comum.policies), []);
  assert.deepEqual(queixasDePolicy(espacada.policies), []);
});

test("o gate mede o piso: policy que cita auth.uid() sem filtrar por ele passa", () => {
  const objetos = objetosDe(
    "create policy frouxa on public.t for select using (auth.uid() is not null);",
  );

  // Declarado, não escondido. Provar que isto isola exige Postgres real, e o
  // único lugar que sobe um é o job `sql` do CI.
  assert.deepEqual(queixasDePolicy(objetos.policies), []);
});

// -------------------------------------------- regra (d): declaração órfã, RED

const TABELA_SEM_RLS = "create table public.esquecida (id int);";

test("uma isenção que casa com a queixa silencia aquela queixa, e só ela", () => {
  const objetos = objetosDe(TABELA_SEM_RLS + "\ncreate table public.outra (id int);");

  const isencao: ExcecaoIsolamento = {
    chave: chaveDaTabela("public.esquecida"),
    motivo: "tabela de apoio sem dado de usuário, mantida assim enquanto X.",
    oQueExigeRemover: "habilitar RLS na tabela e apagar esta declaração.",
  };

  const queixas = queixasDeIsolamento(objetos, [isencao]);

  assert.equal(queixas.length, 1);
  assert.match(queixas[0], /public\.outra/);
});

test("RED: isenção para objeto que já cumpre a regra é 1 queixa órfã, com a chave", () => {
  const objetos = objetosDe(
    "create table public.certinha (id int);\n" +
      "alter table public.certinha enable row level security;",
  );

  const orfa: ExcecaoIsolamento = {
    chave: chaveDaTabela("public.certinha"),
    motivo: "motivo que já não vale.",
    oQueExigeRemover: "nada — a tabela já tem RLS.",
  };

  const queixas = queixasDeIsolamento(objetos, [orfa]);

  assert.equal(queixas.length, 1);
  assert.match(queixas[0], /tabela:public\.certinha/);
  assert.match(queixas[0], /já cumpre a regra/);
});

test("RED: isenção para objeto que nenhuma migração cria é queixa de fantasma", () => {
  const objetos = objetosDe(TABELA_SEM_RLS);

  const fantasma: ExcecaoIsolamento = {
    chave: chaveDaTabela("public.nunca_existiu"),
    motivo: "motivo qualquer.",
    oQueExigeRemover: "nada.",
  };

  const queixas = queixasDeIsolamento(objetos, [fantasma]);

  assert.equal(queixas.length, 2);
  assert.match(queixas[1], /nenhuma migração cria/);
});

test("RED: isenção de view órfã usa a chave de view, não a de tabela", () => {
  const objetos = objetosDe(
    "create view public.vw_ok with (security_invoker = true) as select 1;",
  );

  const orfa: ExcecaoIsolamento = {
    chave: "view:public.vw_ok",
    motivo: "motivo que já não vale.",
    oQueExigeRemover: "nada.",
  };

  assert.equal(queixasDeIsolamento(objetos, [orfa]).length, 1);
  assert.match(queixasDeIsolamento(objetos, [orfa])[0], /view:public\.vw_ok.*já cumpre/);
});

test("a chave separa objetos homônimos: isenção de view não silencia a tabela", () => {
  const objetos = objetosDe("create table public.x (id int);");

  const deView: ExcecaoIsolamento = {
    chave: "view:public.x",
    motivo: "motivo qualquer.",
    oQueExigeRemover: "nada.",
  };

  const queixas = queixasDeIsolamento(objetos, [deView]);

  // A queixa da tabela sobrevive, e a isenção de view vira fantasma: duas.
  assert.equal(queixas.length, 2);
  assert.match(queixas[0], /public\.x .*enable row level security/);
  assert.match(queixas[1], /view:public\.x/);
});

// ----------------------------------------------- as três regras juntas, RED

test("RED: as três violações no mesmo SQL produzem três queixas, uma por objeto", () => {
  const objetos = objetosDe(
    "create table public.t (id int);\n" +
      "create view public.vw_v as select 1;\n" +
      "create policy p on public.t for select using (true);",
  );

  const queixas = queixasDeIsolamento(objetos);

  assert.equal(queixas.length, 3);
  assert.match(queixas[0], /public\.vw_v/);
  assert.match(queixas[1], /public\.t/);
  assert.match(queixas[2], /\bp\b/);
});

test("a chave de policy carrega a tabela — duas policies homônimas não se confundem", () => {
  assert.equal(chaveDaPolicy("sel", "public.a"), "policy:sel@public.a");
  assert.notEqual(chaveDaPolicy("sel", "public.a"), chaveDaPolicy("sel", "public.b"));
});
