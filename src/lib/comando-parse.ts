// Máquina de extração do menu de comandos. A API pública é parseComando, em
// comando.ts — este módulo é o miolo: o léxico PT-BR, os extratores e as
// regras de coerência.
//
// A frase é consumida em passes: cada extrator varre os tokens ainda livres,
// marca os que reconheceu e devolve o que extraiu (ou um ComandoInvalido). A
// ordem dos passes é significativa — o nome do cartão é casado antes das
// parcelas para "3x" não roubar um token de um cartão chamado "Inter 3x", e a
// descrição é o que sobrou no fim. Quem mexer aqui: mantenha a ordem de
// extrairTudo.
//
// O import de comando.ts é `import type`: some na compilação, então não há
// ciclo em runtime entre os dois módulos.

import { paraCentavos } from "./money.ts";
import { MAX_PARCELAS_UI } from "./constantes.ts";
import type { CartaoRef, ComandoInvalido, ComandoTransacao } from "./comando.ts";

export type Forma = ComandoTransacao["forma"];
export type TipoTransacao = ComandoTransacao["tipoTransacao"];

export function invalido(motivo: string): ComandoInvalido {
  return { tipo: "invalido", motivo };
}

/** Distingue "extraí um valor" de "a frase é ambígua e a recusa é o resultado". */
export function ehInvalido(valor: unknown): valor is ComandoInvalido {
  return (
    typeof valor === "object" &&
    valor !== null &&
    (valor as { tipo?: unknown }).tipo === "invalido"
  );
}

/** Acento-insensível: "análise" e "analise" são o mesmo comando. */
export function nrm(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

// ------------------------------- Datas -------------------------------

function dataValida(ano: number, mes: number, dia: number): boolean {
  const d = new Date(Date.UTC(ano, mes - 1, dia));
  return (
    d.getUTCFullYear() === ano && d.getUTCMonth() === mes - 1 && d.getUTCDate() === dia
  );
}

function iso(ano: number, mes: number, dia: number): string {
  return `${ano}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
}

function somarDias(isoData: string, dias: number): string {
  const d = new Date(`${isoData}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

// ------------------------------ Léxico ------------------------------

const VERBOS_RUIDO = new Set([
  "lancar", "lanca", "lancei", "adicionar", "adiciona", "add", "registrar",
  "registra", "gastei", "paguei", "comprei", "gasto",
]);
const MARCAS_RECEITA = new Set(["recebi", "ganhei", "receita", "recebimento", "entrou"]);
const RUIDO_MOEDA = new Set(["reais", "real", "r$", "conto", "pila"]);
const FORMAS_AVISTA: Record<string, "DEBITO" | "PIX" | "DINHEIRO"> = {
  debito: "DEBITO",
  pix: "PIX",
  dinheiro: "DINHEIRO",
};

const RE_VALOR = /^(?:r\$)?\d+(?:\.\d{3})*(?:,\d{1,2})?$|^(?:r\$)?\d+(?:[.,]\d{1,2})?$/;
const RE_PARCELA_X = /^(\d{1,3})x$/;
const RE_NUM_CURTO = /^\d{1,2}$/;
const RE_DATA_ABSOLUTA = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/;

// ------------------------------- Frase -------------------------------

/**
 * Os tokens da frase mais a marcação de consumo. `usado` é mutável de
 * propósito: é o acumulador que impede dois extratores de reivindicarem o
 * mesmo token. A mutação não escapa de parseComando, que continua puro.
 */
export type Frase = {
  readonly tokens: readonly string[];
  readonly norm: readonly string[];
  readonly usado: boolean[];
};

export function fatiar(bruto: string): Frase {
  const tokens = bruto.split(" ");
  return {
    tokens,
    norm: tokens.map(nrm),
    usado: new Array<boolean>(tokens.length).fill(false),
  };
}

/** Come a preposição imediatamente antes de `i` ("no nubank", "em 3x"). */
function consumirPreposicao(f: Frase, i: number, palavras: readonly string[]): void {
  if (i > 0 && !f.usado[i - 1] && palavras.includes(f.norm[i - 1])) {
    f.usado[i - 1] = true;
  }
}

// ----------------------------- Extratores -----------------------------

/**
 * Cartão por nome ("no nubank"): sequência de tokens igual ao nome, o mais
 * longo primeiro para "nubank ultravioleta" não perder para "nubank".
 */
function extrairCartao(f: Frase, cartoes: readonly CartaoRef[]): CartaoRef | null {
  const ordenados = [...cartoes].sort((a, b) => nrm(b.nome).length - nrm(a.nome).length);
  for (const cartao of ordenados) {
    const partes = nrm(cartao.nome).split(/\s+/);
    for (let i = 0; i <= f.norm.length - partes.length; i++) {
      if (f.usado[i]) continue;
      if (!partes.every((p, j) => !f.usado[i + j] && f.norm[i + j] === p)) continue;
      for (let j = 0; j < partes.length; j++) f.usado[i + j] = true;
      consumirPreposicao(f, i, ["no", "na"]);
      return cartao;
    }
  }
  return null;
}

/** "3x" ou "3 vezes"; `fim` é o último token da expressão. */
function lerParcelas(f: Frase, i: number): { n: number; fim: number } | null {
  const mX = f.norm[i].match(RE_PARCELA_X);
  if (mX) return { n: Number(mX[1]), fim: i };
  if (RE_NUM_CURTO.test(f.norm[i]) && f.norm[i + 1] === "vezes" && !f.usado[i + 1]) {
    return { n: Number(f.norm[i]), fim: i + 1 };
  }
  return null;
}

/** Parcelas: "em 3x", "3x", "em 3 vezes", "3 vezes". Ausente = 1. */
function extrairParcelas(f: Frase): number | ComandoInvalido {
  for (let i = 0; i < f.norm.length; i++) {
    if (f.usado[i]) continue;
    const achado = lerParcelas(f, i);
    if (!achado) continue;
    if (achado.n > MAX_PARCELAS_UI) {
      return invalido(`Máximo de ${MAX_PARCELAS_UI} parcelas.`);
    }
    if (achado.n < 1) return invalido("Parcelas: mínimo 1.");
    for (let j = i; j <= achado.fim; j++) f.usado[j] = true;
    consumirPreposicao(f, i, ["em"]);
    return achado.n;
  }
  return 1;
}

function lerDiaDoMes(
  f: Frase,
  i: number,
  ano: number,
  mes: number,
): string | ComandoInvalido | null {
  if (f.usado[i + 1] || !RE_NUM_CURTO.test(f.norm[i + 1] ?? "")) return null;
  const dia = Number(f.norm[i + 1]);
  if (!dataValida(ano, mes, dia)) {
    return invalido(`Dia ${dia} não existe neste mês.`);
  }
  f.usado[i] = f.usado[i + 1] = true;
  return iso(ano, mes, dia);
}

function lerDataAbsoluta(
  f: Frase,
  i: number,
  anoHoje: number,
): string | ComandoInvalido | null {
  const m = f.norm[i].match(RE_DATA_ABSOLUTA);
  if (!m) return null;
  const dia = Number(m[1]);
  const mes = Number(m[2]);
  const ano = m[3] ? (m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])) : anoHoje;
  if (!dataValida(ano, mes, dia)) {
    return invalido(`Data inválida: ${f.tokens[i]}.`);
  }
  f.usado[i] = true;
  return iso(ano, mes, dia);
}

/** Data: "hoje" | "ontem" | "anteontem" | "dia N" | "dd/mm[/aaaa]". */
function extrairData(f: Frase, hoje: string): string | ComandoInvalido {
  const [anoHoje, mesHoje] = hoje.split("-").map(Number);
  for (let i = 0; i < f.norm.length; i++) {
    if (f.usado[i]) continue;
    const t = f.norm[i];
    if (t === "hoje") {
      f.usado[i] = true;
      return hoje;
    }
    if (t === "ontem" || t === "anteontem") {
      f.usado[i] = true;
      return somarDias(hoje, t === "ontem" ? -1 : -2);
    }
    const achada =
      t === "dia" ? lerDiaDoMes(f, i, anoHoje, mesHoje) : lerDataAbsoluta(f, i, anoHoje);
    if (achada) return achada;
  }
  return hoje;
}

/**
 * Forma à vista explícita ("no débito", "pix", "dinheiro") ou "crédito".
 * Varre a frase inteira de propósito: é o passe que detecta duas formas na
 * mesma frase. `inicial` vem do cartão nomeado, que já implica crédito.
 */
function extrairForma(f: Frase, inicial: Forma | null): Forma | null | ComandoInvalido {
  let forma = inicial;
  for (let i = 0; i < f.norm.length; i++) {
    if (f.usado[i]) continue;
    const t = f.norm[i];
    if (t === "boleto") {
      return invalido("Boleto tem vencimento — use o formulário de Transações.");
    }
    const avista = FORMAS_AVISTA[t];
    if (!avista && t !== "credito") continue;
    const desta: Forma = avista ?? "CREDITO";
    if (forma && forma !== desta) {
      return invalido("Mais de uma forma de pagamento na frase.");
    }
    forma = desta;
    f.usado[i] = true;
    consumirPreposicao(f, i, ["no", "em"]);
  }
  return forma;
}

function extrairTipo(f: Frase): TipoTransacao {
  for (let i = 0; i < f.norm.length; i++) {
    if (!f.usado[i] && MARCAS_RECEITA.has(f.norm[i])) {
      f.usado[i] = true;
      return "RECEITA";
    }
  }
  return "DESPESA";
}

/** "50 reais de ifood": ruído de moeda e o "de" logo depois saem juntos. */
function consumirRuidoDeMoeda(f: Frase, inicio: number): void {
  let k = inicio;
  while (k < f.norm.length && !f.usado[k] && RUIDO_MOEDA.has(f.norm[k])) {
    f.usado[k++] = true;
  }
  if (k < f.norm.length && !f.usado[k] && f.norm[k] === "de") f.usado[k] = true;
}

/**
 * Valor: primeiro token com cara de dinheiro ainda livre. `null` significa
 * "não é transação" — o menu cai para as sugestões de navegação.
 */
function extrairValor(f: Frase): number | null | ComandoInvalido {
  for (let i = 0; i < f.norm.length; i++) {
    if (f.usado[i] || !RE_VALOR.test(f.norm[i])) continue;
    const centavos = paraCentavos(f.tokens[i]);
    if (!Number.isFinite(centavos)) {
      return invalido(`Valor inválido: ${f.tokens[i]}.`);
    }
    f.usado[i] = true;
    consumirRuidoDeMoeda(f, i + 1);
    return centavos;
  }
  return null;
}

/** Descrição: o que sobrou, menos verbos de comando e ruído de moeda. */
function montarDescricao(f: Frase): string | ComandoInvalido {
  const descricao = f.tokens
    .filter(
      (_, i) => !f.usado[i] && !VERBOS_RUIDO.has(f.norm[i]) && !RUIDO_MOEDA.has(f.norm[i]),
    )
    .join(" ")
    .trim();
  return descricao || invalido("Falta a descrição (ex.: 45 ifood).");
}

// ---------------------------- Orquestração ----------------------------

/** O que os extratores tiraram da frase, antes da coerência. */
export type Extracao = {
  cartao: CartaoRef | null;
  numParcelas: number;
  dataCompra: string;
  formaExplicita: Forma | null;
  tipoTransacao: TipoTransacao;
  valorCentavos: number;
  descricao: string;
};

/** Roda os passes na ordem. `null` = a frase não descreve uma transação. */
export function extrairTudo(
  f: Frase,
  hoje: string,
  cartoes: readonly CartaoRef[],
): Extracao | ComandoInvalido | null {
  const cartao = extrairCartao(f, cartoes);

  const numParcelas = extrairParcelas(f);
  if (ehInvalido(numParcelas)) return numParcelas;

  const dataCompra = extrairData(f, hoje);
  if (ehInvalido(dataCompra)) return dataCompra;

  // O cartão nomeado já implica crédito; extrairForma parte daí para achar
  // conflito com uma forma à vista dita na mesma frase.
  const formaExplicita = extrairForma(f, cartao ? "CREDITO" : null);
  if (ehInvalido(formaExplicita)) return formaExplicita;

  const tipoTransacao = extrairTipo(f);

  const valorCentavos = extrairValor(f);
  if (ehInvalido(valorCentavos)) return valorCentavos;
  if (valorCentavos === null) return null;

  const descricao = montarDescricao(f);
  if (ehInvalido(descricao)) return descricao;

  return {
    cartao,
    numParcelas,
    dataCompra,
    formaExplicita,
    tipoTransacao,
    valorCentavos,
    descricao,
  };
}
