import { test } from "node:test";
import assert from "node:assert/strict";
import {
  chaveDaView,
  extrairObjetos,
  lerMigracoes,
  linhaDe,
  objetosDe,
  queixasDeView,
  semLiteral,
} from "../gate/migracoes.ts";

// CONTRATO
//   Garante  — que o extrator de tests/gate/migracoes.ts LÊ as migrações reais
//              (e a contagem do que leu é impressa e conferida), e que toda
//              view de public declara `with (security_invoker = true)`.
//   Falha se — alguma view de public não declarar a opção; o extrator parar de
//              enxergar os objetos que existem hoje; ou um bloco ilegível
//              passar em silêncio em vez de recusar.
//   Espelha  — o TEXTO das migrações. Não afirma nada sobre o schema real: o
//              banco pode ter uma view criada à mão que nenhuma migração cita.
//   Vermelho — provado com SQL sintético inline em cada regra.
//
// A contagem é assertada de propósito. Sobre o disco de hoje as cinco views já
// declaram security_invoker, então este gate NASCE verde — e verde de um gate
// que não lê nada é indistinguível de verde de um gate que lê tudo. Travar a
// contagem é o que faz "passou" significar "passou depois de olhar".

const ESPERADO = {
  tabelas: 11,
  /** DECLARAÇÕES, não nomes: vw_carteira é redefinida três vezes. */
  views: 5,
  viewsDistintas: 3,
  policies: 23,
  rls: 11,
} as const;

// ---------------------------------------------------------------- o gate real

test("suíte real: o extrator lê as migrações do disco, e a contagem é esta", () => {
  const migracoes = lerMigracoes();
  const objetos = extrairObjetos(migracoes);
  const distintas = new Set(objetos.views.map((v) => v.nome));

  console.log(
    `   lidos de supabase/migrations: ${migracoes.length} arquivos -> ` +
      `${objetos.tabelas.length} tabelas, ${objetos.views.length} declarações de ` +
      `view (${distintas.size} nomes distintos), ${objetos.policies.length} ` +
      `policies, ${objetos.rls.length} habilitações de RLS`,
  );

  assert.ok(migracoes.length > 0, "não li migração nenhuma — o diretório mudou de lugar?");
  assert.equal(objetos.tabelas.length, ESPERADO.tabelas);
  assert.equal(objetos.views.length, ESPERADO.views);
  assert.equal(distintas.size, ESPERADO.viewsDistintas);
  assert.equal(objetos.policies.length, ESPERADO.policies);
  assert.equal(objetos.rls.length, ESPERADO.rls);
});

test("suíte real: toda view de public declara security_invoker = true", () => {
  const objetos = extrairObjetos(lerMigracoes());

  assert.deepEqual(
    queixasDeView(objetos.views),
    [],
    "view de public sem security_invoker roda com o privilégio do dono e vaza " +
      "linha de outro usuário. Declare `with (security_invoker = true)`.",
  );
});

test("suíte real: cada view lida aponta para um arquivo e uma linha de verdade", () => {
  const migracoes = lerMigracoes();
  const porArquivo = new Map(migracoes.map((m) => [m.arquivo, m.bruto.split("\n")]));

  for (const view of extrairObjetos(migracoes).views) {
    const linhas = porArquivo.get(view.arquivo);
    assert.ok(linhas, `${view.nome} aponta para ${view.arquivo}, que não foi lido`);
    assert.match(
      linhas[view.linha - 1] ?? "",
      /create\s+(or\s+replace\s+)?view/i,
      `${view.nome}: ${view.arquivo}:${view.linha} não é a linha do create view`,
    );
  }
});

test("suíte real: a 0027 não injeta objeto fantasma a partir dos literais dela", () => {
  const objetos = extrairObjetos(lerMigracoes());
  const daZeroVinteSete = (arquivo: string): boolean => arquivo.startsWith("0027");

  // A 0027 cita 'CREATE TABLE' num IN (...) e monta um `alter table ... enable
  // row level security` dentro de format(). Os dois são dado, não DDL — e o
  // segundo é o perigoso, porque aprovaria uma tabela que não existe.
  assert.deepEqual(objetos.tabelas.filter((t) => daZeroVinteSete(t.arquivo)), []);
  assert.deepEqual(objetos.rls.filter((r) => daZeroVinteSete(r.arquivo)), []);
});

// ------------------------------------------------- a regra da view, RED

test("RED: view sem security_invoker é exatamente uma queixa, com o nome dela", () => {
  const objetos = objetosDe(
    "create or replace view public.vw_vazando as select * from public.faturas;",
  );

  const queixas = queixasDeView(objetos.views);

  assert.equal(queixas.length, 1);
  assert.match(queixas[0], /public\.vw_vazando/);
  assert.match(queixas[0], /security_invoker/);
});

test("RED: security_invoker = false é queixa, não é declaração", () => {
  const objetos = objetosDe(
    "create view public.vw_falsa with (security_invoker = false) as select 1;",
  );

  const queixas = queixasDeView(objetos.views);

  assert.equal(queixas.length, 1);
  assert.match(queixas[0], /public\.vw_falsa/);
});

test("RED: uma redefinição sem a opção é queixa mesmo quando a última a declara", () => {
  const objetos = objetosDe(
    "create or replace view public.vw_x with (security_invoker = true) as select 1;\n" +
      "create or replace view public.vw_x as select 2;\n" +
      "create or replace view public.vw_x with (security_invoker = true) as select 3;",
  );

  assert.equal(objetos.views.length, 3);
  assert.equal(queixasDeView(objetos.views).length, 1);
});

test("view com a opção declarada não é queixa, e outras opções não atrapalham", () => {
  const objetos = objetosDe(
    "create view public.vw_ok with (check_option = cascaded, security_invoker = true) " +
      "as select 1;",
  );

  assert.deepEqual(queixasDeView(objetos.views), []);
  assert.equal(objetos.views[0].opcoes["check_option"], "cascaded");
});

test("view de outro schema não é queixa deste gate, e nem entra na lista", () => {
  const objetos = objetosDe("create view interno.vw_fora as select 1;");

  assert.deepEqual(objetos.views, []);
  assert.deepEqual(queixasDeView(objetos.views), []);
});

// ------------------------------------------------ recusa: o parser não adivinha

test("recusa: view sem `as` lança em vez de sumir da conferência", () => {
  assert.throws(
    () => objetosDe("create view public.vw_torta with (security_invoker = true);"),
    /não é seguida por `as`/,
  );
});

test("recusa: `with (` que não fecha lança citando a view", () => {
  assert.throws(
    () => objetosDe("create view public.vw_aberta with (security_invoker = true as select 1;"),
    /abre e nunca fecha/,
  );
});

test("recusa: opção que não é `chave = valor` lança em vez de virar aprovação", () => {
  assert.throws(
    () => objetosDe("create view public.vw_estranha with (security_barrier) as select 1;"),
    /não sei ler a opção "security_barrier"/,
  );
});

test("recusa: objeto sem schema lança — supor public aprovaria por omissão", () => {
  assert.throws(() => objetosDe("create table sem_schema (id int);"), /não está qualificado/);
  assert.throws(
    () => objetosDe("create view sem_schema_v with (security_invoker = true) as select 1;"),
    /não está qualificado/,
  );
});

test("recusa: policy sem `;` lança — corpo pela metade pode parecer que filtra", () => {
  assert.throws(
    () => objetosDe("create policy p on public.t for select using (true)"),
    /não tem `;` terminando/,
  );
});

test("recusa: literal de string que não fecha lança citando a linha", () => {
  assert.throws(
    () => objetosDe("select 1;\nselect 'aberto para sempre;\n"),
    /literal de string aberto na linha 2/,
  );
});

// ------------------------------------------------------- o esvaziador de literal

test("semLiteral esvazia o conteúdo e mantém as quebras de linha", () => {
  const saida = semLiteral("select 'linha um\nlinha dois' as x;", "t.sql");

  assert.equal(saida, "select ''\n as x;");
  assert.equal(linhaDe(saida, saida.indexOf("as x")), 2);
});

test("semLiteral trata aspa dobrada como aspa dentro da string", () => {
  assert.equal(semLiteral("select 'a''b' as x;", "t.sql"), "select '' as x;");
});

test("semLiteral apaga DDL que mora dentro de literal — o caso da 0027", () => {
  const sql =
    "execute format('alter table %s enable row level security', x);\n" +
    "where command_tag in ('CREATE TABLE', 'CREATE TABLE AS');";

  const objetos = objetosDe(sql);

  assert.deepEqual(objetos.rls, []);
  assert.deepEqual(objetos.tabelas, []);
});

test("comentário não vira objeto, e objeto comentado não vira aprovação", () => {
  const objetos = objetosDe(
    "-- create view public.vw_comentada with (security_invoker = true) as select 1;\n" +
      "create view public.vw_real as select 1;",
  );

  assert.equal(objetos.views.length, 1);
  assert.equal(objetos.views[0].nome, "public.vw_real");
});

// -------------------------------------------------------------------- a chave

test("chaveDaView é estável — é ela que a lista de exceções vai casar", () => {
  assert.equal(chaveDaView("public.vw_carteira"), "view:public.vw_carteira");
});
