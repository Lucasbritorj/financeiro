import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { ACOES_LOCAIS, type AcaoLocal } from "../gate/etapas.ts";

// CONTRATO
//   Garante  — que o preflight do gate local reprova de fato um package.json
//              fora de sincronia com o package-lock.json, aprova quando eles
//              batem, e não apaga node_modules em nenhum dos dois casos.
//   Falha se — o comando parar de distinguir sincronizado de dessincronizado,
//              passar a escrever em disco, ou o exit code deixar de ser 1 na
//              dessincronia (o CI para no código, não na mensagem).
//   Espelha  — o comportamento do comando, não a lista: quem confere que o
//              preflight continua declarado e ancorado é
//              tests/unit/gate-node-ci.test.ts.
//   Vermelho — provado abaixo dessincronizando uma cópia descartável.
//
// Por que este teste roda o comando de verdade, e não um dublê: a única coisa
// que ele precisa garantir é que `npm ci --dry-run` REPROVA o que o `npm ci`
// do CI reprovaria. Um mock de spawnSync provaria que o runner chama o
// comando — coisa que gate-runner.test.ts já prova — e não provaria nada
// sobre o npm, que é justamente a parte que pode mudar embaixo de nós numa
// atualização de versão.
//
// Por que numa CÓPIA e não no próprio repositório: dessincronizar o
// package.json do repo para depois restaurá-lo deixa uma janela em que um
// teste interrompido (Ctrl-C, falha de energia, outro teste em paralelo)
// abandona o arquivo modificado. A cópia torna a restauração irrelevante para
// a segurança do repo, e o teste continua provando a restauração — só que
// onde errar não custa nada.

/** O comando que o gate roda de verdade, lido da lista que o runner executa. */
function preflight(): AcaoLocal {
  const acao = ACOES_LOCAIS.find((a) => a.reduzLacunaDe === "npm ci");

  if (!acao) {
    throw new Error(
      "não há ação local ancorada em `npm ci`. Se o preflight do lock foi " +
        "removido de ACOES_LOCAIS, este teste não tem mais objeto — e o gate " +
        "voltou a não ver lock dessincronizado.",
    );
  }

  return acao;
}

const RAIZ = fileURLToPath(new URL("../../", import.meta.url));

/** Cópia descartável do par package.json + package-lock.json do repositório. */
function montarCopia(): string {
  const dir = mkdtempSync(join(tmpdir(), "gate-lock-"));

  for (const arquivo of ["package.json", "package-lock.json"]) {
    copyFileSync(join(RAIZ, arquivo), join(dir, arquivo));
  }

  return dir;
}

function rodarPreflight(cwd: string): { status: number; saida: string } {
  const [comando, ...args] = preflight().comando;
  const execucao = spawnSync(comando, args, { cwd, encoding: "utf8", shell: true });

  return {
    // Morto por sinal não tem status; 1 mantém o vermelho, como no runner.
    status: execucao.status ?? 1,
    saida: `${execucao.stdout ?? ""}${execucao.stderr ?? ""}`,
  };
}

/** Acrescenta ao package.json da cópia uma dependência que o lock não tem. */
function dessincronizar(dir: string, pacote: string, faixa: string): void {
  const caminho = join(dir, "package.json");
  const pkg = JSON.parse(readFileSync(caminho, "utf8")) as {
    dependencies: Record<string, string>;
  };

  pkg.dependencies[pacote] = faixa;
  writeFileSync(caminho, `${JSON.stringify(pkg, null, 2)}\n`);
}

test("o preflight aprova o lock deste repositório e não toca em node_modules", () => {
  const dir = montarCopia();

  try {
    // node_modules com um marcador dentro: se o comando apagasse a árvore —
    // que é o que o `npm ci` de verdade faz, e o motivo de ele estar fora do
    // gate local — o marcador sumiria junto.
    mkdirSync(join(dir, "node_modules"), { recursive: true });
    const marcador = join(dir, "node_modules", "nao-me-apague.txt");
    writeFileSync(marcador, "escrito antes do preflight");

    const { status, saida } = rodarPreflight(dir);

    assert.equal(status, 0, `o par do repositório deveria estar sincronizado.\n${saida}`);
    assert.ok(existsSync(marcador), "o preflight apagou node_modules");
    assert.equal(readFileSync(marcador, "utf8"), "escrito antes do preflight");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("o preflight reprova dependência que o lock não tem, e o verde volta ao restaurar", () => {
  const dir = montarCopia();

  try {
    const original = readFileSync(join(dir, "package.json"), "utf8");

    dessincronizar(dir, "left-pad", "^1.3.0");
    const vermelho = rodarPreflight(dir);

    // O exit code é o que importa: o runner do gate para no código, e um
    // comando que só reclamasse no texto seguiria como verde.
    assert.equal(vermelho.status, 1, `dessincronizado deveria sair 1.\n${vermelho.saida}`);
    assert.match(vermelho.saida, /left-pad/);
    assert.match(vermelho.saida, /lock file/i);

    // Restaurar precisa devolver o verde: se não devolvesse, o vermelho acima
    // poderia ser qualquer outra coisa do ambiente, e não a dessincronia.
    writeFileSync(join(dir, "package.json"), original);
    const verde = rodarPreflight(dir);

    assert.equal(verde.status, 0, `restaurado deveria sair 0.\n${verde.saida}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
