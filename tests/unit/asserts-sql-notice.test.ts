import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { lerAsserts, noticesDeSucesso, semComentario } from "./_asserts-sql.ts";

// tests/sql/run_asserts.sh não confia no código de saída do psql: ele exige que
// a saída case com um padrão de sucesso, senão declara a suíte vermelha. Um
// assert que roda inteiro mas anuncia o sucesso em outro formato derruba a
// suíte — e só na execução com Postgres, que precisa de Docker e que o CI deste
// repo nunca executou verde. Este gate antecipa isso para o `npm test`.

const CAMINHO_RUNNER = new URL("../../tests/sql/run_asserts.sh", import.meta.url);

/**
 * O padrão de sucesso lido do próprio runner, não copiado para cá.
 *
 * Copiar seria criar uma segunda fonte de verdade que diverge em silêncio: o
 * runner mudaria o critério e este gate seguiria medindo o critério antigo,
 * verde. Se a extração falhar, o gate morre em vez de continuar medindo nada.
 */
function padraoDoRunner(): RegExp {
  const runner = readFileSync(CAMINHO_RUNNER, "utf8");
  const casamento = runner.match(/grep\s+-q\s+"([^"]+)"/);

  if (!casamento) {
    throw new Error(
      "não achei o padrão de sucesso em tests/sql/run_asserts.sh. O runner mudou de forma: " +
        "reescreva esta extração antes de confiar no gate, senão ele fica verde medindo nada.",
    );
  }
  return new RegExp(casamento[1]);
}

/** O arquivo anuncia sucesso num formato que o runner reconhece? */
function emiteNoticeCompativel(codigo: string, padrao: RegExp): boolean {
  return noticesDeSucesso(codigo).some((notice) => padrao.test(notice));
}

test("padraoDoRunner: extrai o critério que o runner realmente usa", () => {
  const padrao = padraoDoRunner();

  // Amostras reais dos dois formatos que a suíte usa hoje.
  assert.equal(padrao.test("OK: 21/21 asserts do núcleo transacional passaram."), true);
  assert.equal(padrao.test("OK: todos os asserts passaram >>> log"), true);
});

// O gate só vale se souber falhar.
test("emiteNoticeCompativel: notice com outra palavra é violação", () => {
  const padrao = padraoDoRunner();

  assert.equal(emiteNoticeCompativel("raise notice 'SUCESSO: 3/3 asserts';", padrao), false);
});

test("emiteNoticeCompativel: OK sem a palavra asserts é violação", () => {
  const padrao = padraoDoRunner();

  assert.equal(emiteNoticeCompativel("raise notice 'OK: tudo certo';", padrao), false);
});

test("emiteNoticeCompativel: notice apenas dentro de comentário é violação", () => {
  // O cabeçalho de verificacao_assistente.sql cita o formato em comentário.
  // Sem remover comentário antes, esse arquivo passaria por anunciar sucesso
  // mesmo que nunca emitisse notice nenhum.
  const padrao = padraoDoRunner();
  const arquivo = ["-- emite \"OK: N/N asserts\" no sucesso.", "begin;", "commit;"].join("\n");

  assert.equal(emiteNoticeCompativel(semComentario(arquivo), padrao), false);
});

test("emiteNoticeCompativel: notice no formato do runner passa", () => {
  const padrao = padraoDoRunner();

  assert.equal(
    emiteNoticeCompativel("raise notice 'OK: 2/2 asserts na guarda de valor.';", padrao),
    true,
  );
});

test("suíte real: todo assert emite notice de sucesso que o runner reconhece", () => {
  const padrao = padraoDoRunner();
  const mudos = lerAsserts()
    .filter((item) => !emiteNoticeCompativel(item.codigo, padrao))
    .map((item) => item.arquivo);

  assert.deepEqual(
    mudos,
    [],
    `${mudos.join(", ")} não emite, fora de comentário, um raise notice que case com ` +
      `${padrao} — o critério de sucesso de tests/sql/run_asserts.sh. Rodando a suíte SQL de ` +
      `verdade, o runner declara SQL SUITE VERMELHA nesse arquivo mesmo que todos os asserts ` +
      `dele passem. Ajuste o notice para o formato "OK: N/N asserts ...".`,
  );
});

test("suíte real: o gate não está vazio — há assert sendo medido", () => {
  // Se lerAsserts devolvesse [], o teste acima ficaria vacuamente verde e
  // ninguém notaria. Aqui isso vira vermelho.
  assert.ok(lerAsserts().length > 0, "nenhum assert em supabase/tests — o gate acima mede nada");
});
