// O runner do alvo local: `npm run gate`.
//
// CONTRATO
//   Faz     — executa as etapas de tests/gate/etapas.ts na ordem do job `node`
//             do CI, aborta na primeira que falhar, sai com o código dela, e
//             imprime ao final o que este gate NÃO cobre.
//   Não faz — não decide quais são as etapas (isso é etapas.ts) e não confere
//             se elas ainda batem com o ci.yml (isso é o gate estático
//             tests/unit/gate-node-ci.test.ts). Não sobe banco, não instala
//             nada, não escreve fora de node_modules e do .next.
//   Escopo  — só o job `node`. O job `sql` está declarado em FORA_DO_ALVO.
//   Vermelho— provado em tests/unit/gate-runner.test.ts com etapas sintéticas.
//
// Este arquivo é importável sem efeito nenhum: a execução só dispara quando ele
// é o módulo principal. É o que permite o teste exercitar a sequência sem rodar
// um `next build` de verdade.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import {
  ACOES_LOCAIS,
  ENV_DO_JOB,
  ETAPAS,
  FORA_DO_ALVO,
  type AcaoLocal,
  type Etapa,
} from "./etapas.ts";

const RAIZ = new URL("../../", import.meta.url);

export interface Resultado {
  readonly etapa: string;
  /** Código de saída. Sempre 0 para etapa não executada. */
  readonly status: number;
  /** `false` para as etapas cujo `local.tipo` é "nenhum". */
  readonly executada: boolean;
  /**
   * `true` para ação de `ACOES_LOCAIS`, que não tem contraparte no ci.yml.
   * O resumo marca essas linhas para ninguém ler o gate local como se o CI
   * também rodasse aquilo.
   */
  readonly local?: boolean;
}

/** Executa uma etapa e devolve o código de saída dela. */
export type Executor = (etapa: Etapa) => number;

/** Executa uma ação local e devolve o código de saída dela. */
export type ExecutorLocal = (acao: AcaoLocal) => number;

/**
 * Roda as etapas em ordem e para na primeira que falhar.
 *
 * Parar é o ponto: o CI também para, e um gate local que segue em frente
 * depois de um `tsc` vermelho gasta dois minutos de `next build` para contar
 * uma falha que já era conhecida no primeiro segundo.
 */
export function executarSequencia(
  etapas: readonly Etapa[],
  executor: Executor,
  log: (linha: string) => void = () => {},
  acoes: readonly AcaoLocal[] = [],
  executorLocal: ExecutorLocal = () => 0,
): Resultado[] {
  const resultados: Resultado[] = [];

  for (const etapa of etapas) {
    if (etapa.local.tipo === "nenhum") {
      resultados.push({ etapa: etapa.ci, status: 0, executada: false });
      log(`-- pulada: ${etapa.ci}`);
    } else {
      log(`== ${etapa.ci}`);
      const status = executor(etapa);
      resultados.push({ etapa: etapa.ci, status, executada: true });

      if (status !== 0) break;
    }

    // As ações locais ancoradas nesta etapa rodam logo depois dela — inclusive
    // quando ela foi PULADA, que é o caso do preflight do lock: a etapa `npm
    // ci` não roda, e é exatamente a lacuna dela que a ação vem reduzir.
    // Depois, e não antes, porque a ordem carrega dependência: validar o lock
    // antes de conferir o pin do npm daria um veredito cuja validade não foi
    // estabelecida.
    let abortou = false;

    for (const acao of acoes) {
      if (acao.reduzLacunaDe !== etapa.ci) continue;

      log(`== ${acao.nome}`);
      const status = executorLocal(acao);
      resultados.push({ etapa: acao.nome, status, executada: true, local: true });

      if (status !== 0) {
        abortou = true;
        break;
      }
    }

    if (abortou) break;
  }

  return resultados;
}

/** O código da primeira etapa que falhou, ou 0 quando nenhuma falhou. */
export function codigoDeSaida(resultados: readonly Resultado[]): number {
  return resultados.find((r) => r.status !== 0)?.status ?? 0;
}

/**
 * Do env do job, só o que falta no ambiente recebido.
 *
 * Preencher o que falta e nada além: quem tem as variáveis reais carregadas
 * continua buildando contra elas, e um clone limpo recebe o mesmo placeholder
 * que o runner do GitHub recebe. Sobrescrever seria o gate mentindo na direção
 * oposta — verde num ambiente que ninguém tem.
 *
 * Devolve o complemento em vez do ambiente inteiro para que o chamador faça
 * `{ ...process.env, ...preencherFaltantes(process.env) }` e o tipo continue
 * sendo o do process.env, sem asserção de tipo no meio do caminho.
 */
export function preencherFaltantes(
  base: Readonly<Record<string, string | undefined>>,
  env: Readonly<Record<string, string>> = ENV_DO_JOB,
): Record<string, string> {
  const faltando: Record<string, string> = {};

  for (const [chave, valor] of Object.entries(env)) {
    // String vazia conta como ausente: `NEXT_PUBLIC_SUPABASE_URL=` exportado
    // sem valor quebraria o build do mesmo jeito que a variável não existir.
    if (!base[chave]) faltando[chave] = valor;
  }

  return faltando;
}

/**
 * O equivalente local do step de pin do CI: confere, não instala.
 *
 * Devolve a queixa, ou `null` quando está tudo certo. A queixa é texto porque
 * é ela que o desenvolvedor lê — "npm 11.6.2, esperado 11.17.0" resolve o
 * problema; "pin inválido" manda ele abrir o ci.yml.
 */
export function avaliarPinDoNpm(emUso: string, declarado: string | undefined): string | null {
  if (!declarado) {
    return "package.json não declara `packageManager`, então não há pin para conferir.";
  }

  if (!declarado.startsWith("npm@")) {
    return `\`packageManager\` declara "${declarado}", que não é um pin de npm.`;
  }

  const esperado = declarado.slice("npm@".length);
  if (emUso !== esperado) {
    return (
      `npm em uso é ${emUso} e o package.json pina ${esperado}. ` +
      `O CI instala o pinado antes de rodar, e as duas versões discordam sobre ` +
      `package-lock.json válido — "verde aqui" não responde "verde em qual npm?". ` +
      `Rode \`npm i -g npm@${esperado}\` se quiser reproduzir o CI.`
    );
  }

  return null;
}

/** O `packageManager` declarado no package.json do repositório. */
export function pinDeclarado(raiz: URL = RAIZ): string | undefined {
  const bruto = readFileSync(new URL("package.json", raiz), "utf8");
  const pkg = JSON.parse(bruto) as { packageManager?: string };
  return pkg.packageManager;
}

/**
 * Executor real. `shell: true` porque no Windows `npm` e `npx` são .cmd e não
 * são executáveis diretos — os comandos são literais de etapas.ts, nunca
 * entrada de fora.
 */
function executorReal(etapa: Etapa): number {
  if (etapa.local.tipo === "interno") {
    const versao = spawnSync("npm", ["--version"], { encoding: "utf8", shell: true });
    const emUso = (versao.stdout ?? "").trim();
    const queixa = avaliarPinDoNpm(emUso, pinDeclarado());

    if (queixa) {
      console.error(`   ${queixa}`);
      return 1;
    }

    console.log(`   npm ${emUso}, igual ao pin do package.json.`);
    return 0;
  }

  if (etapa.local.tipo === "nenhum") return 0;

  const [comando, ...args] = etapa.local.comando;
  const execucao = spawnSync(comando, args, {
    cwd: fileURLToPath(RAIZ),
    env: { ...process.env, ...preencherFaltantes(process.env) },
    stdio: "inherit",
    shell: true,
  });

  // Morto por sinal não tem status: virar 0 seria transformar um kill em verde.
  return execucao.status ?? 1;
}

/**
 * Executor real das ações locais.
 *
 * Captura a saída em vez de herdar o terminal: `npm ci --dry-run` numa árvore
 * ausente lista os 506 pacotes que instalaria, e despejar isso a cada `npm run
 * gate` afogaria o resumo — o gate viraria algo que ninguém lê até o fim.
 * Vermelho imprime tudo, porque é ali que mora a única linha que resolve o
 * problema ("Missing: <pacote> from lock file").
 */
function executorLocalReal(acao: AcaoLocal): number {
  const [comando, ...args] = acao.comando;
  const execucao = spawnSync(comando, args, {
    cwd: fileURLToPath(RAIZ),
    env: { ...process.env, ...preencherFaltantes(process.env) },
    encoding: "utf8",
    shell: true,
  });

  // Morto por sinal não tem status, pelo mesmo motivo de executorReal.
  const status = execucao.status ?? 1;

  if (status !== 0) {
    process.stdout.write(execucao.stdout ?? "");
    process.stderr.write(execucao.stderr ?? "");
  } else {
    console.log("   package.json e package-lock.json em sincronia (nada escrito em disco).");
  }

  return status;
}

function principal(): void {
  console.log("gate local — o job `node` do .github/workflows/ci.yml\n");

  const resultados = executarSequencia(
    ETAPAS,
    executorReal,
    (linha) => {
      console.log(linha);
    },
    ACOES_LOCAIS,
    executorLocalReal,
  );
  const codigo = codigoDeSaida(resultados);

  console.log("\n-- resumo");
  for (const r of resultados) {
    const marca = !r.executada ? "pulada " : r.status === 0 ? "ok     " : "FALHOU ";
    // O sufixo não é decoração: sem ele, uma linha verde do resumo pareceria
    // dizer "o CI também roda isto", e o preflight não tem step no ci.yml.
    const nome = r.local ? `${r.etapa}  [local-only, não é step do CI]` : r.etapa;
    console.log(`   ${marca} ${nome}${r.status !== 0 ? ` (exit ${r.status})` : ""}`);
  }

  // Só as etapas contam: as ações locais também entram em `resultados`, e
  // subtraí-las de ETAPAS.length daria "não alcançadas" negativo num gate que
  // rodou tudo.
  const naoAlcancadas = ETAPAS.length - resultados.filter((r) => !r.local).length;
  if (naoAlcancadas > 0) {
    console.log(`   (${naoAlcancadas} etapa(s) não alcançada(s): a sequência parou antes)`);
  }

  // Impresso sempre, verde ou vermelho. Gate verde que não diz o que não olhou
  // vira licença para push — foi exatamente assim que este repositório perdeu
  // um CI depois de uma suíte verde.
  console.log("\n-- este gate NÃO cobre:");
  for (const item of FORA_DO_ALVO) console.log(`   * ${item}`);

  console.log(
    codigo === 0
      ? "\ngate local verde. Não é o CI inteiro — ver a lista acima."
      : `\ngate local vermelho (exit ${codigo}).`,
  );

  process.exit(codigo);
}

/** Só executa quando chamado direto, para que o teste possa importar em paz. */
const chamadoDireto =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (chamadoDireto) principal();
