// Assistente de análise — motor determinístico que INTERPRETA gastos e
// ganhos. Não é chat nem LLM: são regras sobre os agregados que já
// calculamos, produzindo observações rankeadas por severidade. Lógica
// pura, testada em tests/unit/analise.test.ts. Valores em centavos.
//
// Este arquivo é o contrato público e o ranqueador. As regras em si — um
// detector por padrão observável — vivem em analise-detectores.ts, e as
// primitivas que montam e pontuam uma observação em analise-obs.ts.

import type { TransacaoInsight, SegmentoFrase } from "./insights.ts";
import { resumoDoMes } from "./insights.ts";
import { DETECTORES } from "./analise-detectores.ts";
import { obs } from "./analise-obs.ts";

export { mesesAnteriores } from "./analise-obs.ts";

export type Severidade = "alerta" | "atencao" | "positivo" | "neutro";

export type Observacao = {
  id: string; // slug estável (tipo + chave) para React key
  severidade: Severidade;
  titulo: string;
  segmentos: SegmentoFrase[]; // reusa o estilo Ateliê (ouro/verde/telha)
  metrica?: string; // número destacado opcional, ex "-32%"
  pontuacao: number; // ranking interno; maior = mais relevante
};

/** Nº de observações devolvidas quando o chamador não pede outro corte. */
const LIMITE_PADRAO = 6;

/**
 * Roda todos os detectores, ordena por relevância e devolve os melhores.
 * Se nada de notável, devolve uma leitura neutra amigável (nunca vazio
 * quando há dados; array vazio só quando não há transações no mês).
 */
export function analisarFinancas(
  transacoes: TransacaoInsight[],
  args: { mesISO: string; hojeISO: string; formatar: (c: number) => string; limite?: number },
): Observacao[] {
  const ctx = {
    mesISO: args.mesISO,
    hojeISO: args.hojeISO,
    formatar: args.formatar,
  };
  const todas = DETECTORES.flatMap((d) => d(transacoes, ctx));
  todas.sort((a, b) => b.pontuacao - a.pontuacao);
  if (todas.length > 0) return todas.slice(0, args.limite ?? LIMITE_PADRAO);

  // Nada notável: mês com movimento merece uma leitura; mês sem nenhum
  // lançamento não inventa observação.
  const doMes = resumoDoMes(transacoes, args.mesISO);
  if (doMes.saidas === 0 && doMes.entradas === 0) return [];
  return [
    obs({
      id: "estavel",
      severidade: "neutro",
      titulo: "Mês sob controle",
      segmentos: [
        {
          texto:
            "Nada fora do padrão este mês — seus gastos seguem o ritmo dos meses anteriores.",
        },
      ],
    }),
  ];
}
