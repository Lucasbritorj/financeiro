// Indicadores econômicos do Banco Central (API SGS pública, sem chave):
// https://api.bcb.gov.br/dados/serie/bcdata.sgs.{codigo}/dados/ultimos/1
// A formatação é pura e testável; só fetchIndicadoresBcb faz I/O (chamado de
// Server Component, cache do Next com revalidate de 1h — câmbio é diário,
// índices são mensais; mais fresco que isso não existe na fonte).
// Códigos validados ao vivo em 2026-07-09; a 432 (meta Selic) está quebrada
// no endpoint, por isso a Selic vem da 1178 (anualizada base 252).

export type TipoSerie = "moeda" | "taxaAno" | "percentualMensal";

export type SerieBcb = {
  codigo: number;
  rotulo: string;
  tipo: TipoSerie;
};

export const SERIES_BCB: SerieBcb[] = [
  { codigo: 1, rotulo: "Dólar", tipo: "moeda" },
  { codigo: 21619, rotulo: "Euro", tipo: "moeda" },
  { codigo: 1178, rotulo: "Selic", tipo: "taxaAno" },
  { codigo: 4389, rotulo: "CDI", tipo: "taxaAno" },
  { codigo: 13522, rotulo: "IPCA 12m", tipo: "percentualMensal" },
  { codigo: 433, rotulo: "IPCA mês", tipo: "percentualMensal" },
  { codigo: 189, rotulo: "IGP-M mês", tipo: "percentualMensal" },
];

export type Indicador = {
  rotulo: string;
  /** Valor pronto para exibição: "R$ 5,13", "14,15% a.a.", "-0,50%". */
  valor: string;
  /** Referência do dado: "09/07" (diário) ou "mai/26" (mensal). */
  referencia: string;
};

const MESES_CURTOS = [
  "jan", "fev", "mar", "abr", "mai", "jun",
  "jul", "ago", "set", "out", "nov", "dez",
];

/** "5.1329" + tipo -> string de exibição pt-BR. Lança em valor não numérico. */
export function formatarValorSerie(tipo: TipoSerie, valorBruto: string): string {
  // Number("") === 0: string vazia viraria "R$ 0,00" plausível — rejeitar.
  const n = valorBruto.trim() === "" ? NaN : Number(valorBruto);
  if (!Number.isFinite(n)) throw new Error(`Valor não numérico da API: "${valorBruto}"`);
  const corpo = n.toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  if (tipo === "moeda") return `R$ ${corpo}`;
  if (tipo === "taxaAno") return `${corpo}% a.a.`;
  return `${corpo}%`;
}

/** "09/07/2026" -> "09/07" (diário) ou "jul/26" (mensal). Lança em formato estranho. */
export function formatarReferenciaSerie(tipo: TipoSerie, dataBruta: string): string {
  const m = dataBruta.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) throw new Error(`Data em formato inesperado da API: "${dataBruta}"`);
  if (tipo === "percentualMensal") {
    return `${MESES_CURTOS[Number(m[2]) - 1]}/${m[3].slice(2)}`;
  }
  return `${m[1]}/${m[2]}`;
}

type RespostaSgs = { data: string; valor: string }[];

export type ResultadoBcb = {
  indicadores: Indicador[];
  /** Rótulos das séries que falharam (rede, erro da API ou vazio). */
  falhas: string[];
};

export async function fetchIndicadoresBcb(): Promise<ResultadoBcb> {
  const resultados = await Promise.allSettled(
    SERIES_BCB.map(async (serie) => {
      const resp = await fetch(
        `https://api.bcb.gov.br/dados/serie/bcdata.sgs.${serie.codigo}/dados/ultimos/1?formato=json`,
        { next: { revalidate: 3600 }, signal: AbortSignal.timeout(5000) },
      );
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const corpo = (await resp.json()) as RespostaSgs | unknown;
      // A API devolve {"erro":{}} (não-array) para série indisponível.
      if (!Array.isArray(corpo) || corpo.length === 0) throw new Error("sem dados");
      const ultimo = corpo[corpo.length - 1];
      return {
        rotulo: serie.rotulo,
        valor: formatarValorSerie(serie.tipo, ultimo.valor),
        referencia: formatarReferenciaSerie(serie.tipo, ultimo.data),
      } satisfies Indicador;
    }),
  );

  const indicadores: Indicador[] = [];
  const falhas: string[] = [];
  resultados.forEach((r, i) => {
    if (r.status === "fulfilled") indicadores.push(r.value);
    else falhas.push(SERIES_BCB[i].rotulo);
  });
  return { indicadores, falhas };
}
