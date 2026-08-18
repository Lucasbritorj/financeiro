import { test } from "node:test";
import assert from "node:assert/strict";
import { semComentario } from "./_asserts-sql.ts";
import { semLiteral } from "../gate/migracoes.ts";
import {
  SEARCH_PATH_SEGURO,
  chaveDaFuncao,
  extrairFuncoes,
  funcoesDe,
  lerMigracoesRpc,
  literalEm,
  queixasDeSearchPath,
  spansDeLiteral,
} from "../gate/rpc.ts";

// CONTRATO
//   Garante  — que o extrator de tests/gate/rpc.ts LÊ as funções reais (com a
//              contagem impressa e conferida), e que toda função SECURITY
//              DEFINER de public fixa `search_path = ''`.
//   Falha se — um definer não fixar o vazio; o extrator parar de enxergar as
//              funções que existem hoje; ou um bloco ilegível passar calado.
//   Espelha  — o TEXTO das migrações. Não afirma nada sobre os privilégios
//              reais do banco.
//   Vermelho — provado com SQL sintético inline em cada regra.
//
// A única função que hoje NÃO cumpre a regra é public.rls_auto_enable, com
// `search_path TO 'pg_catalog'` — drift transcrito literal de produção na
// 0027. Ela é isentada em tests/gate/rpc-privilegios.ts, com motivo escrito,
// e NÃO é isentada aqui: esta suíte mede a regra crua, e a contagem de
// violações crus é parte do que ela trava.

const ESPERADO = {
  statements: 65,
  definers: 55,
  naoDefiners: 10,
  definersDistintos: 38,
  /** Statements de definer com o search_path seguro. */
  comVazio: 54,
  /** Nomes distintos de definer com o search_path seguro. */
  distintosComVazio: 37,
  /** A exceção declarada: rls_auto_enable, 'pg_catalog'. */
  violacoesCruas: 1,
} as const;

// ---------------------------------------------------------------- o gate real

test("suíte real: o extrator lê as funções do disco, e a contagem é esta", () => {
  const migracoes = lerMigracoesRpc();
  const funcoes = extrairFuncoes(migracoes);
  const definers = funcoes.filter((f) => f.definer);
  const distintos = new Set(definers.map((f) => f.nome));

  console.log(
    `   lidos de supabase/migrations: ${migracoes.length} arquivos -> ` +
      `${funcoes.length} declarações de função, ${definers.length} SECURITY ` +
      `DEFINER (${distintos.size} nomes distintos) e ` +
      `${funcoes.length - definers.length} não-definer. search_path dos ` +
      `definers: ${definers.filter((f) => f.searchPath === SEARCH_PATH_SEGURO).length}` +
      ` com ${SEARCH_PATH_SEGURO}, ` +
      `${definers.filter((f) => f.searchPath === null).length} ausente, ` +
      `${definers.filter((f) => f.searchPath !== null && f.searchPath !== SEARCH_PATH_SEGURO).map((f) => f.searchPath).join(", ") || "nenhum outro valor"}`,
  );

  assert.ok(migracoes.length > 0, "não li migração nenhuma — o diretório mudou de lugar?");
  assert.equal(funcoes.length, ESPERADO.statements);
  assert.equal(definers.length, ESPERADO.definers);
  assert.equal(funcoes.length - definers.length, ESPERADO.naoDefiners);
  assert.equal(distintos.size, ESPERADO.definersDistintos);
  assert.equal(
    definers.filter((f) => f.searchPath === SEARCH_PATH_SEGURO).length,
    ESPERADO.comVazio,
  );
  assert.equal(
    new Set(
      definers.filter((f) => f.searchPath === SEARCH_PATH_SEGURO).map((f) => f.nome),
    ).size,
    ESPERADO.distintosComVazio,
  );
});

test("o cabeçalho termina no corpo, não numa janela de tamanho fixo", () => {
  // Regressão de um erro real: a primeira passada deste ciclo procurava
  // `security definer` numa janela de 900 caracteres a partir do `create`, e
  // a janela vazava para a função SEGUINTE. Duas funções INVOKER —
  // fn_touch_updated_at (0006) e fn_proxima_ocorrencia (0015) — foram lidas
  // como DEFINER por causa disso. Aqui o limite é a abertura do corpo.
  const funcoes = funcoesDe(
    "create function public.invoker() returns int language sql as $$ select 1 $$;\n" +
      "create function public.definer() returns int language sql security definer " +
      "set search_path = '' as $$ select 2 $$;",
  );

  assert.equal(funcoes.length, 2);
  assert.equal(funcoes[0].definer, false, "a opção da função seguinte vazou para trás");
  assert.equal(funcoes[1].definer, true);
});

test("suíte real: nenhum definer fica SEM search_path", () => {
  const semNada = extrairFuncoes(lerMigracoesRpc()).filter(
    (f) => f.definer && f.searchPath === null,
  );

  assert.deepEqual(semNada.map((f) => `${f.nome} @${f.arquivo}`), []);
});

test("suíte real: a única violação crua é o drift de pg_catalog da 0027", () => {
  const queixas = queixasDeSearchPath(extrairFuncoes(lerMigracoesRpc()));

  assert.equal(queixas.length, ESPERADO.violacoesCruas);
  assert.match(queixas[0], /public\.rls_auto_enable/);
  assert.match(queixas[0], /pg_catalog/);
  assert.match(queixas[0], /0027/);
});

test("suíte real: cada função lida aponta para a linha do create dela", () => {
  const migracoes = lerMigracoesRpc();
  const porArquivo = new Map(migracoes.map((m) => [m.arquivo, m.codigo.split("\n")]));

  for (const f of extrairFuncoes(migracoes)) {
    const linhas = porArquivo.get(f.arquivo);
    assert.ok(linhas, `${f.nome} aponta para ${f.arquivo}, que não foi lido`);
    // A linha do índice é a do NOME, que pode estar na mesma linha do create.
    assert.match(
      (linhas[f.linha - 1] ?? "") + (linhas[f.linha - 2] ?? ""),
      /function/i,
      `${f.nome}: ${f.arquivo}:${f.linha} não parece a linha da declaração`,
    );
  }
});

test("suíte real: nenhuma função nasce dentro de literal — DDL dinâmico não existe aqui", () => {
  // Converte "hoje não há DDL dinâmico de função" de suposição em asserção: o
  // conjunto de nomes lido com os literais INTACTOS tem de bater com o lido
  // depois de esvaziá-los. Divergir significa que alguém montou um
  // `create function` dentro de um `execute '...'`, e aí o extrator precisa
  // saber disso — hoje ele recusa, mas quem escrever a migração merece ler o
  // motivo aqui.
  const migracoes = lerMigracoesRpc();
  const comLiteral = extrairFuncoes(migracoes).map((f) => `${f.nome}@${f.arquivo}`);

  const semLiterais = extrairFuncoes(
    migracoes.map((m) => {
      const codigo = semLiteral(m.codigo, m.arquivo);
      return { ...m, codigo, literais: spansDeLiteral(codigo, m.arquivo) };
    }),
  ).map((f) => `${f.nome}@${f.arquivo}`);

  assert.deepEqual(comLiteral, semLiterais);
});

// -------------------------------------------------- a regra do search_path, RED

test("RED: definer sem search_path é 1 queixa, com o nome da função", () => {
  const funcoes = funcoesDe(
    "create function public.perigosa() returns void language plpgsql " +
      "security definer as $fn$ begin end $fn$;",
  );

  const queixas = queixasDeSearchPath(funcoes);

  assert.equal(queixas.length, 1);
  assert.match(queixas[0], /public\.perigosa/);
  assert.match(queixas[0], /não fixa/);
});

test("RED: definer com search_path inseguro é queixa, e a queixa mostra o valor", () => {
  const comPublic = funcoesDe(
    "create function public.f() returns void language plpgsql security definer " +
      "set search_path = 'public' as $fn$ begin end $fn$;",
  );
  const comCatalog = funcoesDe(
    "create function public.g() returns void language plpgsql security definer " +
      "set search_path to 'pg_catalog' as $fn$ begin end $fn$;",
  );

  assert.equal(queixasDeSearchPath(comPublic).length, 1);
  assert.match(queixasDeSearchPath(comPublic)[0], /search_path = 'public'/);
  assert.equal(queixasDeSearchPath(comCatalog).length, 1);
  assert.match(queixasDeSearchPath(comCatalog)[0], /search_path = 'pg_catalog'/);
});

test("definer com o vazio não é queixa, em `=` ou em `to`", () => {
  const igual = funcoesDe(
    "create function public.f() returns void language plpgsql security definer " +
      "set search_path = '' as $fn$ begin end $fn$;",
  );
  const to = funcoesDe(
    "create function public.g() returns void language plpgsql security definer " +
      "set search_path to '' as $$ begin end $$;",
  );

  assert.deepEqual(queixasDeSearchPath(igual), []);
  assert.deepEqual(queixasDeSearchPath(to), []);
});

test("função INVOKER sem search_path não é queixa — vermelho sem risco é ruído", () => {
  const funcoes = funcoesDe(
    "create function public.livre() returns int language sql as $$ select 1 $$;",
  );

  assert.equal(funcoes.length, 1);
  assert.equal(funcoes[0].definer, false);
  assert.deepEqual(queixasDeSearchPath(funcoes), []);
});

test("o corpo não é lido como cabeçalho: pg_catalog dentro do begin não vira opção", () => {
  const funcoes = funcoesDe(
    "create function public.f() returns trigger language plpgsql security definer " +
      "set search_path = '' as $fn$ begin " +
      "new.updated_at := pg_catalog.clock_timestamp(); return new; end $fn$;",
  );

  assert.equal(funcoes[0].searchPath, SEARCH_PATH_SEGURO);
  assert.deepEqual(queixasDeSearchPath(funcoes), []);
});

test("função de outro schema não entra na lista", () => {
  assert.deepEqual(
    funcoesDe("create function interno.f() returns void language sql as $$ select $$;"),
    [],
  );
});

// ------------------------------------------------ recusa: o parser não adivinha

test("recusa: função sem corpo dollar-quote lança em vez de sumir da conferência", () => {
  assert.throws(
    () => funcoesDe("create function public.torta() returns void language sql;"),
    /não achei a abertura do corpo/,
  );
});

test("recusa: create function dentro de literal lança — DDL dinâmico está fora", () => {
  assert.throws(
    () =>
      funcoesDe(
        "do $do$ begin execute 'create function public.fantasma() returns void " +
          "language sql as $x$ select 1 $x$'; end $do$;",
      ),
    /nasce dentro de um literal/,
  );
});

test("recusa: literal que não fecha lança citando a linha", () => {
  assert.throws(() => funcoesDe("select 1;\nselect 'aberto;\n"), /literal de string aberto na linha 2/);
});

// ---------------------------------------------------------- os spans de literal

test("spansDeLiteral marca começo e fim, e aspa dobrada não fecha a string", () => {
  const sql = "select 'a''b' as x, 'c' as y;";
  const spans = spansDeLiteral(sql, "t.sql");

  assert.equal(spans.length, 2);
  assert.equal(sql.slice(spans[0].inicio, spans[0].fim), "'a''b'");
  assert.equal(sql.slice(spans[1].inicio, spans[1].fim), "'c'");
});

test("literalEm distingue código aberto de dentro de literal", () => {
  const sql = "revoke x; execute 'revoke y';";
  const spans = spansDeLiteral(sql, "t.sql");

  assert.equal(literalEm(spans, sql.indexOf("revoke x")), null);
  assert.ok(literalEm(spans, sql.indexOf("revoke y")));
});

test("o comentário sai antes dos spans — apóstrofo em comentário não abre literal", () => {
  const codigo = semComentario("-- nao persiste\nselect 'ok';\n");

  assert.equal(spansDeLiteral(codigo, "t.sql").length, 1);
});

// -------------------------------------------------------------------- a chave

test("chaveDaFuncao é estável — é ela que a lista de exceções vai casar", () => {
  assert.equal(chaveDaFuncao("public.rls_auto_enable"), "funcao:public.rls_auto_enable");
});
