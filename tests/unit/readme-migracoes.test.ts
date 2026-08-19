import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";

// CONTRATO
//   Garante  — que toda migração presente em `supabase/migrations/` está
//              citada pelo NOME COMPLETO do arquivo no README, e que a
//              contagem do que foi lido do disco é conferida.
//   Falha se — migração nova entrar no diretório sem ganhar entrada no README;
//              o README perder uma entrada que existe hoje; ou a leitura do
//              diretório devolver menos arquivos que o piso conhecido.
//   Espelha  — os NOMES dos arquivos, nada além. Não abre uma linha de SQL e
//              não afirma nada sobre o schema real: produção pode ter objeto
//              que nenhuma migração cita (já teve), e isso não é assunto deste
//              gate — é assunto do job `sql` do CI.
//   Vermelho — provado com README sintético em cada regra, e com a lista de
//              migrações vazia.
//
// POR QUE ISTO EXISTE:
// o passo 2 do Setup do README é prosa EXECUTÁVEL — alguém abre o SQL Editor e
// roda o que está escrito ali. Durante um bom tempo ele mandou aplicar
// `0001`–`0006` enquanto o diretório já tinha `0001`–`0027`: 21 migrações fora
// da instrução. Quem seguisse o README montava um banco sem categorias,
// importação, cofrinhos, carteira, boletos nem recorrências — e descobriria
// isso na primeira tela que consultasse um objeto inexistente, não no setup.
// Prosa não reprova ninguém. Este gate faz a divergência custar um teste
// vermelho no mesmo `npm test` de sempre, no dia em que ela acontece.
//
// POR QUE UM PISO, E NÃO A CONTAGEM EXATA:
// `tests/unit/gate-migracoes-views.test.ts` trava contagens exatas, e ali está
// certo: view ou policy a mais é mudança que pede revisão. Aqui não — migração
// é registro append-only, e `0028` chegar é o curso normal do projeto. Contagem
// exata ficaria vermelha no dia de uma migração nova QUE JÁ VEIO COM a entrada
// no README, ou seja, um vermelho que não aponta defeito nenhum. O piso mede a
// propriedade que interessa (o gate está mesmo lendo o diretório real) sem
// disparar no crescimento legítimo. Quem regride a lista é a regra de citação,
// não a contagem.
//
// O que ele NÃO garante: que a ORDEM listada no README é a ordem correta de
// aplicação, e que o conteúdo de cada migração faz o que o rótulo ao lado diz.
// Citação é presença, não semântica.

const RAIZ = new URL("../../", import.meta.url);
const DIR_MIGRACOES = new URL("supabase/migrations/", RAIZ);
const ARQUIVO_README = new URL("README.md", RAIZ);

/**
 * Piso de migrações no disco. Só sobe — e só quando alguém confirmar que subiu
 * de verdade. Existe para que "nenhuma queixa" nunca possa significar "não li
 * arquivo nenhum": sem ele, apagar o diretório deixaria este gate verde.
 */
const MINIMO_DE_MIGRACOES = 27;

/** Os nomes de arquivo de migração, em ordem numérica. Não lê conteúdo. */
export function nomesDeMigracao(dir: URL = DIR_MIGRACOES): string[] {
  return readdirSync(dir)
    .filter((nome) => nome.endsWith(".sql"))
    .sort();
}

/**
 * As migrações que o texto do README não cita pelo nome completo do arquivo.
 *
 * Lista vazia de entrada é RECUSADA, não aprovada: devolver "nenhuma queixa"
 * para um diretório que não foi lido é exatamente o verde por ilegibilidade
 * que este arquivo existe para não ter.
 */
export function naoCitadas(
  readme: string,
  arquivos: readonly string[],
): string[] {
  if (arquivos.length === 0) {
    throw new Error(
      "lista de migrações vazia: o diretório supabase/migrations/ não foi " +
        "lido, ou mudou de lugar. Gate verde aqui seria verde por não ter " +
        "olhado.",
    );
  }
  return arquivos.filter((nome) => !readme.includes(nome));
}

// ---------------------------------------------------------------- o gate real

test("suíte real: o README cita todas as migrações do disco", () => {
  const arquivos = nomesDeMigracao();
  const readme = readFileSync(ARQUIVO_README, "utf8");

  assert.ok(
    arquivos.length >= MINIMO_DE_MIGRACOES,
    `supabase/migrations/ devolveu ${arquivos.length} arquivo(s), abaixo do ` +
      `piso de ${MINIMO_DE_MIGRACOES}. Migração não some — isto é o diretório ` +
      `movido, renomeado ou não lido, não uma limpeza legítima.`,
  );

  const faltando = naoCitadas(readme, arquivos);
  assert.deepEqual(
    faltando,
    [],
    `o README não cita ${faltando.length} de ${arquivos.length} migração(ões): ` +
      `${faltando.join(", ")}. O passo 2 do Setup é a instrução que alguém vai ` +
      `executar — migração fora dela é banco montado incompleto.`,
  );
});

// ------------------------------------------------------------- vermelho provado

test("vermelho: migração no disco e ausente do README é acusada pelo nome", () => {
  const arquivos = ["0001_nucleo.sql", "0002_motor.sql", "0003_novidade.sql"];
  const readme = "Execute `0001_nucleo.sql` e depois `0002_motor.sql`.";

  assert.deepEqual(naoCitadas(readme, arquivos), ["0003_novidade.sql"]);
});

test("vermelho: citar só o número não conta como citar a migração", () => {
  const arquivos = ["0007_editar_transacao.sql"];
  const readme = "Aplique as migrações de 0001 a 0007 em ordem.";

  assert.deepEqual(naoCitadas(readme, arquivos), ["0007_editar_transacao.sql"]);
});

test("vermelho: lista de migrações vazia é recusada, não aprovada", () => {
  assert.throws(
    () => naoCitadas("um README que cita tudo que existe, que é nada", []),
    /lista de migrações vazia/,
  );
});

test("verde de controle: README que cita todas não gera queixa", () => {
  const arquivos = ["0001_nucleo.sql", "0002_motor.sql"];
  const readme = "- `0001_nucleo.sql`\n- `0002_motor.sql`\n";

  assert.deepEqual(naoCitadas(readme, arquivos), []);
});

test("o leitor de diretório devolve só .sql, em ordem numérica", () => {
  const arquivos = nomesDeMigracao();

  assert.ok(arquivos.every((nome) => nome.endsWith(".sql")));
  assert.deepEqual(arquivos, [...arquivos].sort());
  assert.equal(arquivos[0], "0001_nucleo_transacional.sql");
});
