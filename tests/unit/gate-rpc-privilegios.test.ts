import { test } from "node:test";
import assert from "node:assert/strict";
import { semComentario } from "./_asserts-sql.ts";
import {
  chaveDaFuncao,
  extrairFuncoes,
  lerMigracoesRpc,
  spansDeLiteral,
  type MigracaoLida,
} from "../gate/rpc.ts";
import {
  EXCECOES_RPC,
  PAPEIS_PRETENDIDOS,
  PAPEIS_REVOGADOS,
  extrairPrivilegios,
  papeisDe,
  queixasCruas,
  queixasDeGrant,
  queixasDeRevoke,
  queixasDeRpc,
  queixasOrfas,
  type ExcecaoRpc,
} from "../gate/rpc-privilegios.ts";

// CONTRATO
//   Garante  — que todo definer de public tem `revoke execute` nomeando public
//              e anon, que todo `grant execute` aponta só para os papéis
//              pretendidos, e que a lista de isenções não guarda declaração
//              órfã.
//   Falha se — um definer novo entrar sem revoke; um grant abrir para papel
//              fora da lista; ou a isenção do rls_auto_enable sobreviver ao
//              dia em que a função for alinhada.
//   Espelha  — o TEXTO das migrações. Os privilégios REAIS do banco podem ter
//              sido mexidos à mão e nada aqui veria.
//   Vermelho — provado com SQL sintético inline em cada regra.

const ESPERADO = {
  definersDistintos: 38,
  /** Uma só: o drift de pg_catalog do rls_auto_enable. */
  excecoes: 1,
} as const;

/** Monta uma migração sintética do jeito que lerMigracoesRpc monta as reais. */
function sintetica(sql: string, arquivo = "<sintetico>.sql"): MigracaoLida[] {
  const codigo = semComentario(sql);
  return [{ arquivo, bruto: sql, codigo, literais: spansDeLiteral(codigo, arquivo) }];
}

const de = (sql: string) => {
  const m = sintetica(sql);
  return { funcoes: extrairFuncoes(m), privilegios: extrairPrivilegios(m) };
};

/**
 * As isenções de um universo sintético: nenhuma.
 *
 * Passar isto EXPLICITAMENTE em todo RED não é cerimônia. `queixasDeRpc` cai
 * em `EXCECOES_RPC` por default, e a isenção real fala de
 * `public.rls_auto_enable` — que num SQL sintético não existe. O default
 * arrastava a isenção real para dentro do teste e ela virava órfã lá, somando
 * uma queixa que o RED não pediu. Foi assim que este arquivo falhou na
 * primeira execução: o mecanismo estava certo e o teste é que herdava um
 * mundo que não era o dele.
 */
const SEM_ISENCAO: readonly ExcecaoRpc[] = [];

// ---------------------------------------------------------------- o gate real

test("suíte real: as migrações do disco não têm queixa de contrato de RPC", () => {
  const migracoes = lerMigracoesRpc();
  const funcoes = extrairFuncoes(migracoes);
  const privilegios = extrairPrivilegios(migracoes);
  const revokes = privilegios.filter((p) => p.tipo === "revoke");
  const grants = privilegios.filter((p) => p.tipo === "grant");
  const papeis = new Set(grants.reduce<string[]>((a, g) => a.concat(g.papeis), []));

  console.log(
    `   conferidos: ${new Set(funcoes.filter((f) => f.definer).map((f) => f.nome)).size} ` +
      `definers distintos contra ${revokes.length} revokes ` +
      `(${new Set(revokes.map((r) => r.funcao)).size} funções, ` +
      `${revokes.filter((r) => r.dinamico).length} dentro de execute '...'), e ` +
      `${grants.length} grants para os papéis [${[...papeis].join(", ")}]. ` +
      `${EXCECOES_RPC.length} isenção(ões) declarada(s).`,
  );

  assert.equal(
    new Set(funcoes.filter((f) => f.definer).map((f) => f.nome)).size,
    ESPERADO.definersDistintos,
  );
  assert.ok(revokes.length > 0, "não li revoke nenhum — o extrator parou de ler?");
  assert.ok(grants.length > 0, "não li grant nenhum — o extrator parou de ler?");

  assert.deepEqual(
    queixasDeRpc(funcoes, privilegios),
    [],
    "o contrato de RPC saiu de sincronia com o que o CLAUDE.md promete.",
  );
});

test("suíte real: todo definer distinto tem revoke nomeando public e anon", () => {
  const migracoes = lerMigracoesRpc();

  assert.deepEqual(
    queixasDeRevoke(extrairFuncoes(migracoes), extrairPrivilegios(migracoes)).map(
      (q) => q.funcao,
    ),
    [],
  );
});

test("suíte real: todo grant aponta só para os papéis pretendidos", () => {
  const migracoes = lerMigracoesRpc();

  assert.deepEqual(queixasDeGrant(extrairPrivilegios(migracoes)), []);
  assert.deepEqual(PAPEIS_PRETENDIDOS, ["authenticated"]);
});

test("suíte real: o revoke dinâmico da 0022 é lido, e a lista de papéis sai limpa", () => {
  // `execute 'revoke execute on function public.rls_auto_enable() from public,
  // anon, authenticated'` — o comando termina na ASPA, não no `;` que vem
  // depois. Sem essa distinção o último papel sairia como `authenticated'`, e
  // papeisDe recusaria o arquivo inteiro.
  const dinamicos = extrairPrivilegios(lerMigracoesRpc()).filter((p) => p.dinamico);

  assert.ok(dinamicos.length > 0, "nenhum privilégio dinâmico lido — a 0022 mudou?");
  for (const p of dinamicos) {
    for (const papel of p.papeis) assert.match(papel, /^[a-z_]\w*$/);
  }
  assert.ok(
    dinamicos.some((p) => p.funcao === "public.rls_auto_enable"),
    "o revoke guardado do rls_auto_enable sumiu da leitura",
  );
});

test("suíte real: a única isenção é a do search_path do rls_auto_enable, e ela é substantiva", () => {
  assert.equal(EXCECOES_RPC.length, ESPERADO.excecoes);

  for (const e of EXCECOES_RPC) {
    assert.ok(e.motivo.length > 80, `isenção ${e.funcao}: motivo é etiqueta, não motivo`);
    assert.ok(e.oQueExigeRemover.length > 40, `isenção ${e.funcao}: não diz o que a remove`);
  }

  assert.equal(EXCECOES_RPC[0].regra, "search-path");
  assert.equal(EXCECOES_RPC[0].funcao, chaveDaFuncao("public.rls_auto_enable"));
});

test("suíte real: a isenção declarada NÃO é órfã — ela isenta uma violação que existe", () => {
  const migracoes = lerMigracoesRpc();
  const cruas = queixasCruas(extrairFuncoes(migracoes), extrairPrivilegios(migracoes));

  // Se um dia o rls_auto_enable for alinhado em `''`, esta asserção cai junto
  // com a queixa crua — que é exatamente o ponto da regra da órfã.
  assert.ok(
    cruas.some(
      (q) => q.regra === "search-path" && q.funcao === chaveDaFuncao("public.rls_auto_enable"),
    ),
    "a violação crua sumiu: alinhe ou apague a isenção",
  );
  assert.deepEqual(queixasOrfas(EXCECOES_RPC, cruas, extrairFuncoes(migracoes)), []);
});

test("suíte real: a isenção compra UMA regra — o revoke do rls_auto_enable NÃO é isento", () => {
  const migracoes = lerMigracoesRpc();
  const privilegios = extrairPrivilegios(migracoes);
  const doAuto = privilegios.filter((p) => p.funcao === "public.rls_auto_enable");

  // A função é isenta de `search-path` e de mais nada. O revoke dela é cobrado
  // como o de qualquer outra, e ela cumpre: DUAS vezes, porque a 0022 revoga
  // dentro de um `execute` guardado por `if exists` (a função ainda não existe
  // naquela ordem) e a 0027 revoga estático depois de criá-la. O comentário da
  // 0022 chama isso de "revoke delegado à 0027".
  assert.equal(doAuto.length, 2);
  assert.equal(doAuto.filter((p) => p.dinamico).length, 1);
  assert.equal(doAuto.filter((p) => !p.dinamico).length, 1);
  for (const p of doAuto) assert.deepEqual(p.papeis, ["public", "anon", "authenticated"]);

  assert.deepEqual(
    EXCECOES_RPC.filter((e) => e.funcao === chaveDaFuncao("public.rls_auto_enable")).map(
      (e) => e.regra,
    ),
    ["search-path"],
  );
});

test("a isenção de search-path não silencia o revoke, provado sem depender do repo", () => {
  const { funcoes, privilegios } = de(DEFINER_SEM_SEARCH_PATH);

  const soSearchPath: ExcecaoRpc = {
    regra: "search-path",
    funcao: chaveDaFuncao("public.f"),
    motivo: "motivo qualquer.",
    oQueExigeRemover: "nada.",
  };

  const queixas = queixasDeRpc(funcoes, privilegios, [soSearchPath]);

  assert.equal(queixas.length, 1);
  assert.match(queixas[0], /nenhuma migração revoga/);
});

// ------------------------------------------------------ regra (b): revoke, RED

const DEFINER_OK =
  "create function public.f() returns void language plpgsql security definer " +
  "set search_path = '' as $fn$ begin end $fn$;";

/** Viola as duas regras de uma vez: sem search_path e sem revoke. */
const DEFINER_SEM_SEARCH_PATH =
  "create function public.f() returns void language plpgsql security definer " +
  "as $fn$ begin end $fn$;";

test("RED: definer sem revoke é 1 queixa, com o nome da função", () => {
  const { funcoes, privilegios } = de(DEFINER_OK);

  const queixas = queixasDeRpc(funcoes, privilegios, SEM_ISENCAO);

  assert.equal(queixas.length, 1);
  assert.match(queixas[0], /public\.f/);
  assert.match(queixas[0], /NASCE com execute concedido a PUBLIC/);
});

test("RED: revoke que nomeia só public não basta — os dois papéis ou nada", () => {
  const soPublic = de(DEFINER_OK + "\nrevoke execute on function public.f() from public;");
  const soAnon = de(DEFINER_OK + "\nrevoke execute on function public.f() from anon;");
  const ambos = de(DEFINER_OK + "\nrevoke execute on function public.f() from public, anon;");

  assert.equal(queixasDeRpc(soPublic.funcoes, soPublic.privilegios, SEM_ISENCAO).length, 1);
  assert.equal(queixasDeRpc(soAnon.funcoes, soAnon.privilegios, SEM_ISENCAO).length, 1);
  assert.deepEqual(queixasDeRpc(ambos.funcoes, ambos.privilegios, SEM_ISENCAO), []);
});

test("revoke dentro de execute '...' conta, e termina na aspa", () => {
  const { funcoes, privilegios } = de(
    DEFINER_OK +
      "\ndo $do$ begin execute 'revoke execute on function public.f() from public, " +
      "anon, authenticated'; end $do$;",
  );

  assert.equal(privilegios.length, 1);
  assert.equal(privilegios[0].dinamico, true);
  assert.deepEqual(privilegios[0].papeis, ["public", "anon", "authenticated"]);
  assert.deepEqual(queixasDeRpc(funcoes, privilegios, SEM_ISENCAO), []);
});

test("função INVOKER não precisa de revoke — a regra é sobre privilégio elevado", () => {
  const { funcoes, privilegios } = de(
    "create function public.livre() returns int language sql as $$ select 1 $$;",
  );

  assert.deepEqual(queixasDeRpc(funcoes, privilegios, SEM_ISENCAO), []);
});

// ------------------------------------------------------- regra (c): grant, RED

const REVOGADO = "\nrevoke execute on function public.f() from public, anon;";

test("RED: grant para anon é queixa, citando função e papel", () => {
  const { funcoes, privilegios } = de(
    DEFINER_OK + REVOGADO + "\ngrant execute on function public.f() to anon;",
  );

  const queixas = queixasDeRpc(funcoes, privilegios, SEM_ISENCAO);

  assert.equal(queixas.length, 1);
  assert.match(queixas[0], /public\.f/);
  assert.match(queixas[0], /"anon"/);
});

test("RED: grant misto acusa só o papel indevido, e um por papel", () => {
  const { privilegios } = de(
    DEFINER_OK + REVOGADO + "\ngrant execute on function public.f() to authenticated, public;",
  );

  const queixas = queixasDeGrant(privilegios);

  assert.equal(queixas.length, 1);
  assert.match(queixas[0].texto, /"public"/);
});

test("grant só para authenticated não é queixa, e a AUSÊNCIA de grant também não", () => {
  const comGrant = de(
    DEFINER_OK + REVOGADO + "\ngrant execute on function public.f() to authenticated;",
  );
  const semGrant = de(DEFINER_OK + REVOGADO);

  assert.deepEqual(queixasDeRpc(comGrant.funcoes, comGrant.privilegios, SEM_ISENCAO), []);
  // Função de trigger e de cron não é chamável por cliente: exigir grant seria
  // o gate mandando ABRIR privilégio que hoje está fechado.
  assert.deepEqual(queixasDeRpc(semGrant.funcoes, semGrant.privilegios, SEM_ISENCAO), []);
});

// -------------------------------------------- regra (d): declaração órfã, RED

test("uma isenção que casa com a queixa silencia aquela queixa, e só ela", () => {
  const { funcoes, privilegios } = de(DEFINER_OK);

  const isencao: ExcecaoRpc = {
    regra: "revoke",
    funcao: chaveDaFuncao("public.f"),
    motivo: "motivo qualquer com mais de oitenta caracteres para passar no teste de substância da lista.",
    oQueExigeRemover: "acrescentar o revoke execute e apagar esta declaração.",
  };

  assert.deepEqual(queixasDeRpc(funcoes, privilegios, [isencao]), []);
});

test("RED: isenção para função que já cumpre a regra é queixa órfã, com regra e nome", () => {
  const { funcoes, privilegios } = de(DEFINER_OK + REVOGADO);

  const orfa: ExcecaoRpc = {
    regra: "revoke",
    funcao: chaveDaFuncao("public.f"),
    motivo: "motivo que já não vale.",
    oQueExigeRemover: "nada.",
  };

  const queixas = queixasDeRpc(funcoes, privilegios, [orfa]);

  assert.equal(queixas.length, 1);
  assert.match(queixas[0], /funcao:public\.f/);
  assert.match(queixas[0], /"revoke"/);
  assert.match(queixas[0], /já cumpre a regra/);
});

test("RED: isenção para função que nenhuma migração cria é queixa de fantasma", () => {
  const { funcoes, privilegios } = de(DEFINER_OK + REVOGADO);

  const fantasma: ExcecaoRpc = {
    regra: "revoke",
    funcao: chaveDaFuncao("public.nunca_existiu"),
    motivo: "motivo qualquer.",
    oQueExigeRemover: "nada.",
  };

  const queixas = queixasDeRpc(funcoes, privilegios, [fantasma]);

  assert.equal(queixas.length, 1);
  assert.match(queixas[0], /nenhuma migração cria/);
});

test("a isenção casa por (regra, função): a de search-path não silencia o revoke", () => {
  const { funcoes, privilegios } = de(DEFINER_OK);

  const deSearchPath: ExcecaoRpc = {
    regra: "search-path",
    funcao: chaveDaFuncao("public.f"),
    motivo: "motivo qualquer.",
    oQueExigeRemover: "nada.",
  };

  const queixas = queixasDeRpc(funcoes, privilegios, [deSearchPath]);

  // A queixa do revoke sobrevive, e a isenção de search-path vira órfã: duas.
  assert.equal(queixas.length, 2);
  assert.match(queixas[0], /nenhuma migração revoga/);
  assert.match(queixas[1], /órfã/);
});

// ------------------------------------------------ recusa: o parser não adivinha

test("recusa: revoke sem lista de papéis lança", () => {
  assert.throws(
    () => de(DEFINER_OK + "\nrevoke execute on function public.f();"),
    /não diz de\/para quem/,
  );
});

test("recusa: revoke sem `;` lança", () => {
  assert.throws(
    () => de(DEFINER_OK + "\nrevoke execute on function public.f() from public, anon"),
    /não tem `;` terminando/,
  );
});

test("recusa: papel que não é identificador simples lança em vez de virar conclusão", () => {
  assert.throws(() => papeisDe("public, anon'", "t.sql"), /não sei ler "anon'" como nome de papel/);
  assert.throws(() => papeisDe("public, 2anon", "t.sql"), /não sei ler "2anon"/);
});

test("papeisDe normaliza espaço e caixa, e aceita underscore", () => {
  assert.deepEqual(papeisDe(" Public ,  ANON , service_role ", "t.sql"), [
    "public",
    "anon",
    "service_role",
  ]);
  assert.deepEqual(PAPEIS_REVOGADOS, ["public", "anon"]);
});
