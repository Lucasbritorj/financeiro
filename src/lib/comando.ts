// Parser puro do menu de comandos (Ctrl+K): transforma uma frase PT-BR
// ("lançar 89,90 ifood ontem em 3x no nubank") num payload pronto para a
// RPC processar_transacao_completa, ou numa ação de navegação. Nenhum I/O:
// recebe hoje e a lista de cartões por parâmetro, como analise.ts/insights.ts.
// Ambiguidade dura vira ComandoInvalido com motivo — nunca chute silencioso.

import { paraCentavos } from "./money.ts";
import { MAX_PARCELAS_UI } from "./constantes.ts";

export type CartaoRef = { id: string; nome: string };

export type ComandoTransacao = {
  tipo: "transacao";
  descricao: string;
  valorCentavos: number;
  tipoTransacao: "DESPESA" | "RECEITA";
  forma: "CREDITO" | "DEBITO" | "PIX" | "DINHEIRO";
  cartaoId: string | null;
  cartaoNome: string | null;
  dataCompra: string; // ISO yyyy-mm-dd
  numParcelas: number;
};
export type ComandoNavegacao = { tipo: "navegacao"; rota: string; rotulo: string };
export type ComandoInvalido = { tipo: "invalido"; motivo: string };
export type Comando = ComandoTransacao | ComandoNavegacao | ComandoInvalido;

export type ContextoComando = {
  /** Data de hoje em ISO (yyyy-mm-dd), fuso de exibição do app. */
  hoje: string;
  cartoes: CartaoRef[];
};

// Acento-insensível: "análise" e "analise" são o mesmo comando.
function nrm(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

// ----------------------------- Navegação -----------------------------

const ROTAS: { rota: string; rotulo: string; aliases: string[] }[] = [
  { rota: "/dashboard", rotulo: "Dashboard", aliases: ["dashboard", "inicio", "painel"] },
  { rota: "/analise", rotulo: "Análise", aliases: ["analise", "insights", "observacoes"] },
  { rota: "/transacoes", rotulo: "Transações", aliases: ["transacoes", "lancamentos", "extrato"] },
  {
    rota: "/faturas",
    rotulo: "Contas a pagar",
    aliases: ["contas a pagar", "contas", "faturas", "boletos"],
  },
  { rota: "/categorias", rotulo: "Categorias", aliases: ["categorias"] },
  { rota: "/importar", rotulo: "Importar", aliases: ["importar", "importacao", "csv"] },
  { rota: "/cofrinhos", rotulo: "Cofrinhos", aliases: ["cofrinhos", "cofrinho", "metas"] },
  { rota: "/cartoes", rotulo: "Cartões", aliases: ["cartoes", "cartao"] },
];

/** Rotas cujo alias começa com o texto digitado — alimenta as sugestões do menu. */
export function sugerirRotas(texto: string): ComandoNavegacao[] {
  const t = nrm(texto.trim()).replace(/^(ir para|ir pra|abrir|ver|mostrar)\s+/, "");
  const achadas = ROTAS.filter(
    (r) => t === "" || r.aliases.some((a) => a.startsWith(t)),
  );
  return achadas.map((r) => ({ tipo: "navegacao", rota: r.rota, rotulo: r.rotulo }));
}

function tentarNavegacao(texto: string): ComandoNavegacao | null {
  const t = nrm(texto.trim());
  const semVerbo = t.replace(/^(ir para|ir pra|abrir|ver|mostrar)\s+/, "");
  // Alias "cru" só vale sem dígitos no texto ("ver 50" não é navegação).
  if (semVerbo === t && /\d/.test(t)) return null;
  const rota = ROTAS.find((r) => r.aliases.includes(semVerbo));
  return rota ? { tipo: "navegacao", rota: rota.rota, rotulo: rota.rotulo } : null;
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

// ------------------------------ Parser ------------------------------

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

export function parseComando(texto: string, ctx: ContextoComando): Comando | null {
  const bruto = texto.trim().replace(/\s+/g, " ");
  if (!bruto) return null;

  const nav = tentarNavegacao(bruto);
  if (nav) return nav;

  const tokens = bruto.split(" ");
  const norm = tokens.map(nrm);
  const usado = new Array<boolean>(tokens.length).fill(false);

  // Cartão por nome ("no nubank"): sequência de tokens igual ao nome, o mais
  // longo primeiro para "nubank ultravioleta" não perder para "nubank".
  let cartaoId: string | null = null;
  let cartaoNome: string | null = null;
  let formaExplicita: ComandoTransacao["forma"] | null = null;
  const cartoesOrdenados = [...ctx.cartoes].sort(
    (a, b) => nrm(b.nome).length - nrm(a.nome).length,
  );
  for (const cartao of cartoesOrdenados) {
    const partes = nrm(cartao.nome).split(/\s+/);
    for (let i = 0; i <= norm.length - partes.length; i++) {
      if (usado[i]) continue;
      if (partes.every((p, j) => !usado[i + j] && norm[i + j] === p)) {
        for (let j = 0; j < partes.length; j++) usado[i + j] = true;
        if (i > 0 && !usado[i - 1] && (norm[i - 1] === "no" || norm[i - 1] === "na")) {
          usado[i - 1] = true;
        }
        cartaoId = cartao.id;
        cartaoNome = cartao.nome;
        formaExplicita = "CREDITO";
        break;
      }
    }
    if (cartaoId) break;
  }

  // Parcelas: "em 3x", "3x", "em 3 vezes", "3 vezes".
  let numParcelas = 1;
  for (let i = 0; i < norm.length; i++) {
    if (usado[i]) continue;
    let n: number | null = null;
    let fim = i;
    const mX = norm[i].match(/^(\d{1,3})x$/);
    if (mX) n = Number(mX[1]);
    else if (/^\d{1,3}$/.test(norm[i]) && norm[i + 1] === "vezes" && !usado[i + 1]) {
      n = Number(norm[i]);
      fim = i + 1;
    }
    if (n === null) continue;
    if (n > MAX_PARCELAS_UI) {
      return { tipo: "invalido", motivo: `Máximo de ${MAX_PARCELAS_UI} parcelas.` };
    }
    if (n < 1) return { tipo: "invalido", motivo: "Parcelas: mínimo 1." };
    numParcelas = n;
    for (let j = i; j <= fim; j++) usado[j] = true;
    if (i > 0 && !usado[i - 1] && norm[i - 1] === "em") usado[i - 1] = true;
    break;
  }

  // Data: "hoje" | "ontem" | "anteontem" | "dia N" | "dd/mm[/aaaa]".
  let dataCompra = ctx.hoje;
  const [anoHoje, mesHoje] = ctx.hoje.split("-").map(Number);
  for (let i = 0; i < norm.length; i++) {
    if (usado[i]) continue;
    const t = norm[i];
    if (t === "hoje") {
      usado[i] = true;
      break;
    }
    if (t === "ontem" || t === "anteontem") {
      dataCompra = somarDias(ctx.hoje, t === "ontem" ? -1 : -2);
      usado[i] = true;
      break;
    }
    if (t === "dia" && !usado[i + 1] && /^\d{1,2}$/.test(norm[i + 1] ?? "")) {
      const dia = Number(norm[i + 1]);
      if (!dataValida(anoHoje, mesHoje, dia)) {
        return { tipo: "invalido", motivo: `Dia ${dia} não existe neste mês.` };
      }
      dataCompra = iso(anoHoje, mesHoje, dia);
      usado[i] = usado[i + 1] = true;
      break;
    }
    const mData = t.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/);
    if (mData) {
      const dia = Number(mData[1]);
      const mes = Number(mData[2]);
      const ano = mData[3]
        ? mData[3].length === 2
          ? 2000 + Number(mData[3])
          : Number(mData[3])
        : anoHoje;
      if (!dataValida(ano, mes, dia)) {
        return { tipo: "invalido", motivo: `Data inválida: ${tokens[i]}.` };
      }
      dataCompra = iso(ano, mes, dia);
      usado[i] = true;
      break;
    }
  }

  // Forma à vista explícita ("no débito", "pix", "dinheiro") ou "crédito".
  for (let i = 0; i < norm.length; i++) {
    if (usado[i]) continue;
    const t = norm[i];
    if (t === "boleto") {
      return {
        tipo: "invalido",
        motivo: "Boleto tem vencimento — use o formulário de Transações.",
      };
    }
    const avista = FORMAS_AVISTA[t];
    const ehForma = avista || t === "credito";
    if (!ehForma) continue;
    if (formaExplicita && formaExplicita !== (avista ?? "CREDITO")) {
      return { tipo: "invalido", motivo: "Mais de uma forma de pagamento na frase." };
    }
    formaExplicita = avista ?? "CREDITO";
    usado[i] = true;
    if (i > 0 && !usado[i - 1] && (norm[i - 1] === "no" || norm[i - 1] === "em")) {
      usado[i - 1] = true;
    }
  }

  // Tipo: marca de receita explícita; o resto é despesa.
  let tipoTransacao: ComandoTransacao["tipoTransacao"] = "DESPESA";
  for (let i = 0; i < norm.length; i++) {
    if (!usado[i] && MARCAS_RECEITA.has(norm[i])) {
      tipoTransacao = "RECEITA";
      usado[i] = true;
      break;
    }
  }

  // Valor: primeiro token com cara de dinheiro ainda livre.
  let valorCentavos: number | null = null;
  for (let i = 0; i < norm.length; i++) {
    if (usado[i] || !RE_VALOR.test(norm[i])) continue;
    const centavos = paraCentavos(tokens[i]);
    if (!Number.isFinite(centavos)) {
      return { tipo: "invalido", motivo: `Valor inválido: ${tokens[i]}.` };
    }
    valorCentavos = centavos;
    usado[i] = true;
    // "50 reais de ifood": ruído de moeda e o "de" logo depois saem juntos.
    let k = i + 1;
    while (k < norm.length && !usado[k] && RUIDO_MOEDA.has(norm[k])) usado[k++] = true;
    if (k < norm.length && !usado[k] && norm[k] === "de") usado[k] = true;
    break;
  }
  if (valorCentavos === null) return null; // sem valor não há transação — menu mostra navegação

  // Descrição: o que sobrou, menos verbos de comando e ruído de moeda.
  const descricao = tokens
    .filter((_, i) => !usado[i] && !VERBOS_RUIDO.has(norm[i]) && !RUIDO_MOEDA.has(norm[i]))
    .join(" ")
    .trim();
  if (!descricao) {
    return { tipo: "invalido", motivo: "Falta a descrição (ex.: 45 ifood)." };
  }

  // Regras de coerência — espelham as do formulário/servidor.
  if (tipoTransacao === "RECEITA") {
    if (numParcelas > 1) {
      return { tipo: "invalido", motivo: "Receita não parcela." };
    }
    if (formaExplicita === "CREDITO") {
      return { tipo: "invalido", motivo: "Receita não entra no cartão de crédito." };
    }
  }
  const temCartao = ctx.cartoes.length > 0;
  if (formaExplicita === "CREDITO" && !temCartao) {
    return { tipo: "invalido", motivo: "Cadastre um cartão para lançar no crédito." };
  }
  if (numParcelas > 1 && formaExplicita && formaExplicita !== "CREDITO") {
    return { tipo: "invalido", motivo: "Parcelamento é só no crédito." };
  }
  if (numParcelas > 1 && !temCartao) {
    return { tipo: "invalido", motivo: "Parcelamento exige um cartão cadastrado." };
  }

  // Defaults espelham o formulário: despesa cai no crédito (1º cartão) se
  // houver cartão; receita e quem não tem cartão caem no Pix.
  let forma: ComandoTransacao["forma"];
  if (formaExplicita) forma = formaExplicita;
  else if (numParcelas > 1) forma = "CREDITO";
  else if (tipoTransacao === "RECEITA" || !temCartao) forma = "PIX";
  else forma = "CREDITO";

  if (forma === "CREDITO" && !cartaoId) {
    cartaoId = ctx.cartoes[0]?.id ?? null;
    cartaoNome = ctx.cartoes[0]?.nome ?? null;
    if (!cartaoId) {
      return { tipo: "invalido", motivo: "Cadastre um cartão para lançar no crédito." };
    }
  }

  return {
    tipo: "transacao",
    descricao,
    valorCentavos,
    tipoTransacao,
    forma,
    cartaoId: forma === "CREDITO" ? cartaoId : null,
    cartaoNome: forma === "CREDITO" ? cartaoNome : null,
    dataCompra,
    numParcelas,
  };
}
