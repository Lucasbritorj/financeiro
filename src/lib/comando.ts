// Parser puro do menu de comandos (Ctrl+K): transforma uma frase PT-BR
// ("lançar 89,90 ifood ontem em 3x no nubank") num payload pronto para a
// RPC processar_transacao_completa, ou numa ação de navegação. Nenhum I/O:
// recebe hoje e a lista de cartões por parâmetro, como analise.ts/insights.ts.
// Ambiguidade dura vira ComandoInvalido com motivo — nunca chute silencioso.
//
// Este arquivo é a API pública e a tabela de rotas. O léxico PT-BR e os
// extratores que consomem a frase token a token vivem em comando-parse.ts.

import {
  ehInvalido,
  extrairTudo,
  fatiar,
  invalido,
  nrm,
  type Extracao,
  type Forma,
} from "./comando-parse.ts";

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

const VERBOS_NAVEGACAO = /^(ir para|ir pra|abrir|ver|mostrar)\s+/;

/** Rotas cujo alias começa com o texto digitado — alimenta as sugestões do menu. */
export function sugerirRotas(texto: string): ComandoNavegacao[] {
  const t = nrm(texto.trim()).replace(VERBOS_NAVEGACAO, "");
  const achadas = ROTAS.filter((r) => t === "" || r.aliases.some((a) => a.startsWith(t)));
  return achadas.map((r) => ({ tipo: "navegacao", rota: r.rota, rotulo: r.rotulo }));
}

function tentarNavegacao(texto: string): ComandoNavegacao | null {
  const t = nrm(texto.trim());
  const semVerbo = t.replace(VERBOS_NAVEGACAO, "");
  // Alias "cru" só vale sem dígitos no texto ("ver 50" não é navegação).
  if (semVerbo === t && /\d/.test(t)) return null;
  const rota = ROTAS.find((r) => r.aliases.includes(semVerbo));
  return rota ? { tipo: "navegacao", rota: rota.rota, rotulo: rota.rotulo } : null;
}

// ------------------------------- Parser -------------------------------

export function parseComando(texto: string, ctx: ContextoComando): Comando | null {
  const bruto = texto.trim().replace(/\s+/g, " ");
  if (!bruto) return null;

  const nav = tentarNavegacao(bruto);
  if (nav) return nav;

  const extraido = extrairTudo(fatiar(bruto), ctx.hoje, ctx.cartoes);
  // Sem valor não há transação — menu mostra navegação.
  if (extraido === null) return null;
  if (ehInvalido(extraido)) return extraido;

  return montarTransacao(extraido, ctx.cartoes);
}

// --------------------- Coerência, defaults e montagem ---------------------

/** Regras de coerência — espelham as do formulário/servidor. */
function conferirCoerencia(e: Extracao, temCartao: boolean): ComandoInvalido | null {
  if (e.tipoTransacao === "RECEITA") {
    if (e.numParcelas > 1) return invalido("Receita não parcela.");
    if (e.formaExplicita === "CREDITO") {
      return invalido("Receita não entra no cartão de crédito.");
    }
  }
  if (e.formaExplicita === "CREDITO" && !temCartao) {
    return invalido("Cadastre um cartão para lançar no crédito.");
  }
  if (e.numParcelas > 1 && e.formaExplicita && e.formaExplicita !== "CREDITO") {
    return invalido("Parcelamento é só no crédito.");
  }
  if (e.numParcelas > 1 && !temCartao) {
    return invalido("Parcelamento exige um cartão cadastrado.");
  }
  return null;
}

/**
 * Defaults espelham o formulário: despesa cai no crédito (1º cartão) se
 * houver cartão; receita e quem não tem cartão caem no Pix.
 */
function decidirForma(e: Extracao, temCartao: boolean): Forma {
  if (e.formaExplicita) return e.formaExplicita;
  if (e.numParcelas > 1) return "CREDITO";
  if (e.tipoTransacao === "RECEITA" || !temCartao) return "PIX";
  return "CREDITO";
}

/**
 * Resolve a forma final, o cartão e monta o payload. Crédito sem cartão dito
 * na frase cai no primeiro cadastrado, como no formulário.
 */
function montarTransacao(
  e: Extracao,
  cartoes: readonly CartaoRef[],
): ComandoTransacao | ComandoInvalido {
  const temCartao = cartoes.length > 0;
  const incoerencia = conferirCoerencia(e, temCartao);
  if (incoerencia) return incoerencia;

  const forma = decidirForma(e, temCartao);
  const cartao = forma === "CREDITO" ? (e.cartao ?? cartoes[0] ?? null) : null;
  if (forma === "CREDITO" && !cartao) {
    return invalido("Cadastre um cartão para lançar no crédito.");
  }

  return {
    tipo: "transacao",
    descricao: e.descricao,
    valorCentavos: e.valorCentavos,
    tipoTransacao: e.tipoTransacao,
    forma,
    cartaoId: cartao?.id ?? null,
    cartaoNome: cartao?.nome ?? null,
    dataCompra: e.dataCompra,
    numParcelas: e.numParcelas,
  };
}
