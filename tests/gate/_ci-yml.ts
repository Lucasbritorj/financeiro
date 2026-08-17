// Leitura do .github/workflows/ci.yml, para o gate estático comparar o CI com
// o alvo local.
//
// CONTRATO
//   Faz     — lê um job do ci.yml e devolve o bloco `env:` dele e a identidade
//             de cada step que tem `run:`, na ordem em que aparecem.
//   Não faz — não é um parser de YAML. Entende a forma que este arquivo usa
//             (mapa indentado por espaços, lista de steps com `- `, bloco
//             literal `run: |`) e RECUSA o resto em voz alta.
//   Escopo  — consumido por tests/unit/gate-node-ci.test.ts. Uso fora de
//             tests/ é acidente, não contrato: não é API do app.
//   Vermelho— provado com YAML sintético nos testes daquele arquivo.
//
// Sem dependência externa, pelo mesmo motivo de tests/unit/_asserts-sql.ts:
// node:fs basta, e é isso que permite o gate rodar no `npm test` sem instalar
// um parser de YAML só para ler seis linhas.
//
// A regra que governa este arquivo: quando a estrutura não é a esperada, ele
// LANÇA. Um parser que devolve lista vazia diante do inesperado transforma o
// gate em verde permanente — o modo de falha exato que gates estáticos existem
// para evitar, e que seria invisível justamente quando o ci.yml mudasse.
import { readFileSync } from "node:fs";

const RAIZ = new URL("../../", import.meta.url);
const CAMINHO_CI = new URL(".github/workflows/ci.yml", RAIZ);

/** Prefixo de toda recusa deste módulo, para os testes casarem sem ambiguidade. */
export const ERRO = "ci.yml ilegível:";

export interface JobCI {
  /** O bloco `env:` do job. Vazio quando o job não declara nenhum. */
  readonly env: Readonly<Record<string, string>>;
  /**
   * A identidade de cada step com `run:`, na ordem do arquivo: o `name:` do
   * step quando ele tem um, senão a primeira linha do `run:`.
   *
   * Steps que só têm `uses:` ficam de fora — não são comando, e o equivalente
   * local deles é o ambiente, não uma etapa. tests/gate/etapas.ts declara isso.
   */
  readonly etapasRun: readonly string[];
}

interface Linha {
  readonly texto: string;
  readonly indent: number;
}

function falhar(queixa: string): never {
  throw new Error(`${ERRO} ${queixa}`);
}

function emLinhas(yaml: string): Linha[] {
  return yaml.split(/\r?\n/).map((texto) => ({
    texto,
    indent: texto.length - texto.trimStart().length,
  }));
}

const ehVazia = (l: Linha): boolean => l.texto.trim() === "";
const ehComentario = (l: Linha): boolean => l.texto.trimStart().startsWith("#");

/** As linhas mais indentadas que `linhas[indice]`, até a indentação voltar. */
function blocoFilho(linhas: readonly Linha[], indice: number): Linha[] {
  const pai = linhas[indice].indent;
  const filhas: Linha[] = [];

  for (let i = indice + 1; i < linhas.length; i++) {
    const linha = linhas[i];
    if (ehVazia(linha)) {
      filhas.push(linha);
      continue;
    }
    if (linha.indent <= pai) break;
    filhas.push(linha);
  }

  return filhas;
}

/** Índice da chave `nome:` no nível mais externo de um bloco, ou -1. */
function acharChave(linhas: readonly Linha[], nome: string): number {
  const uteis = linhas.filter((l) => !ehVazia(l) && !ehComentario(l));
  if (uteis.length === 0) return -1;
  const nivel = Math.min(...uteis.map((l) => l.indent));

  return linhas.findIndex(
    (l) => l.indent === nivel && !ehComentario(l) && l.texto.trim().startsWith(`${nome}:`),
  );
}

/** Separa `chave: valor` no primeiro `:`, preservando `:` do valor (URLs). */
function parDeChaveValor(texto: string): { chave: string; valor: string } {
  const corte = texto.indexOf(":");
  if (corte < 0) falhar(`esperava \`chave: valor\` e recebi "${texto.trim()}".`);

  const chave = texto.slice(0, corte).trim();
  let valor = texto.slice(corte + 1).trim();

  const aspas = valor.startsWith('"') && valor.endsWith('"');
  const apostrofos = valor.startsWith("'") && valor.endsWith("'");
  if ((aspas || apostrofos) && valor.length >= 2) valor = valor.slice(1, -1);

  return { chave, valor };
}

/** Agrupa as linhas de `steps:` em um grupo por item da lista. */
function gruposDeSteps(doSteps: readonly Linha[]): Linha[][] {
  const grupos: Linha[][] = [];
  /** Indentação do `- ` de cada grupo, para separar comentário de conteúdo. */
  const marcadores: number[] = [];

  for (const linha of doSteps) {
    if (ehVazia(linha)) continue;

    const marca = linha.texto.trimStart();
    if (marca.startsWith("- ")) {
      // O `- ` vira espaço para que as chaves do step fiquem todas no mesmo
      // nível — `- name: x` e a `run:` de baixo passam a ser irmãs de verdade.
      grupos.push([{ texto: linha.texto.replace(/-\s/, "  "), indent: linha.indent + 2 }]);
      marcadores.push(linha.indent);
      continue;
    }

    if (grupos.length === 0) {
      if (ehComentario(linha)) continue;
      falhar(`linha fora de qualquer step em \`steps:\`: "${marca}".`);
    }

    // Comentário na coluna dos próprios steps documenta o step SEGUINTE, e
    // anexá-lo ao anterior rebaixaria o nível das chaves daquele step a ponto
    // de ele perder a identidade — o step some da lista e o gate fica verde
    // por engano. Comentário mais indentado que o marcador é corpo de bloco
    // literal e continua no grupo, porque lá dentro `#` é comando de shell.
    if (ehComentario(linha) && linha.indent <= marcadores[marcadores.length - 1]) continue;

    grupos[grupos.length - 1].push(linha);
  }

  return grupos;
}

/**
 * A identidade do step, ou `null` quando ele não tem `run:`.
 *
 * Limite declarado: quando o step não tem `name:` e o `run:` é um bloco
 * literal, a identidade é a primeira linha não vazia do bloco — comentário de
 * shell incluído. Nenhum step do ci.yml está nessa forma hoje.
 */
function identidadeDoStep(grupo: readonly Linha[]): string | null {
  // Comentário não conta para o nível: um `#` fora de lugar não pode rebaixar
  // o nível das chaves e fazer o step inteiro desaparecer da comparação.
  const uteis = grupo.filter((l) => !ehVazia(l) && !ehComentario(l));
  if (uteis.length === 0) return null;
  const nivel = Math.min(...uteis.map((l) => l.indent));
  const chaves = uteis.filter((l) => l.indent === nivel);

  const linhaRun = chaves.find((l) => l.texto.trim().startsWith("run:"));
  if (!linhaRun) return null;

  const linhaName = chaves.find((l) => l.texto.trim().startsWith("name:"));
  if (linhaName) {
    const { valor } = parDeChaveValor(linhaName.texto);
    if (valor === "") falhar("step com `name:` vazio — não há identidade para parear.");
    return valor;
  }

  const { valor } = parDeChaveValor(linhaRun.texto);
  if (valor !== "" && valor !== "|" && valor !== "|-" && valor !== ">" && valor !== ">-") {
    return valor;
  }

  const corpo = grupo.slice(grupo.indexOf(linhaRun) + 1).filter((l) => !ehVazia(l));
  const primeira = corpo.find((l) => l.indent > linhaRun.indent);
  if (!primeira) falhar("step com `run:` em bloco literal e nenhuma linha de comando.");

  return primeira.texto.trim();
}

/** Lê um job do ci.yml. Lança quando a estrutura não é a esperada. */
export function lerJobDoCi(yaml: string, job: string): JobCI {
  const linhas = emLinhas(yaml);

  const iJobs = linhas.findIndex((l) => l.indent === 0 && l.texto.trim() === "jobs:");
  if (iJobs < 0) falhar("não achei a chave `jobs:` na coluna 0.");

  const dosJobs = blocoFilho(linhas, iJobs);
  const iJob = dosJobs.findIndex((l) => !ehComentario(l) && l.texto.trim() === `${job}:`);
  if (iJob < 0) falhar(`não achei o job \`${job}\` dentro de \`jobs:\`.`);

  const doJob = blocoFilho(dosJobs, iJob);

  const iSteps = acharChave(doJob, "steps");
  if (iSteps < 0) falhar(`o job \`${job}\` não tem \`steps:\`.`);

  const etapasRun = gruposDeSteps(blocoFilho(doJob, iSteps))
    .map(identidadeDoStep)
    .filter((id): id is string => id !== null);

  if (etapasRun.length === 0) {
    falhar(`o job \`${job}\` não tem nenhum step com \`run:\` — nada para comparar.`);
  }

  const env: Record<string, string> = {};
  const iEnv = acharChave(doJob, "env");
  if (iEnv >= 0) {
    for (const linha of blocoFilho(doJob, iEnv)) {
      if (ehVazia(linha) || ehComentario(linha)) continue;
      const { chave, valor } = parDeChaveValor(linha.texto);
      env[chave] = valor;
    }
  }

  return { env, etapasRun };
}

/** O ci.yml do repositório, cru. */
export function lerCiYml(caminho: URL = CAMINHO_CI): string {
  return readFileSync(caminho, "utf8");
}
