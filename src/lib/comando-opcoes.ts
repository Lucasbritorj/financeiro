// As opções que o menu de comandos (Ctrl+K) mostra para um comando já
// parseado. Lógica pura, extraída de comando-menu.tsx para poder ser testada
// sem renderizar componente.
//
// As opções são DADOS, sem closures: cada uma carrega a ação a executar, e um
// único handler no componente as executa — exigência das regras do React
// Compiler.

import { formatarCentavos, formatarData } from "./money.ts";
import { sugerirRotas, type Comando, type ComandoTransacao } from "./comando.ts";

const FORMA_ROTULO: Record<ComandoTransacao["forma"], string> = {
  CREDITO: "Crédito",
  DEBITO: "Débito",
  PIX: "Pix",
  DINHEIRO: "Dinheiro",
};

export const EXEMPLOS =
  '"45 ifood" · "recebi 4500 salário dia 5" · "500 notebook em 5x" · "ir para cofrinhos"';

export type Opcao = {
  id: string;
  titulo: string;
  detalhe?: string;
  acao: { tipo: "registrar" } | { tipo: "rota"; rota: string };
};

function opcaoDeRota(rota: string, rotulo: string): Opcao {
  return { id: rota, titulo: `Ir para ${rotulo}`, acao: { tipo: "rota", rota } };
}

/** "Nubank em 3x" para crédito parcelado; o rótulo da forma para o resto. */
function meioDePagamento(t: ComandoTransacao): string {
  if (t.forma !== "CREDITO") return FORMA_ROTULO[t.forma];
  const parcelas = t.numParcelas > 1 ? ` em ${t.numParcelas}x` : "";
  return `${t.cartaoNome ?? "Crédito"}${parcelas}`;
}

function opcaoDeTransacao(t: ComandoTransacao, hoje: string): Opcao {
  const quando = t.dataCompra === hoje ? "hoje" : formatarData(t.dataCompra);
  const especie = t.tipoTransacao === "RECEITA" ? "receita" : "despesa";
  return {
    id: "registrar",
    titulo: `Registrar ${especie} · ${formatarCentavos(t.valorCentavos)} — ${t.descricao}`,
    detalhe: `${quando} · ${meioDePagamento(t)} · categoria automática`,
    acao: { tipo: "registrar" },
  };
}

/**
 * Comando inválido não vira opção nenhuma — o motivo é mostrado como dica, e
 * não há o que executar. `null` (frase sem valor) cai nas sugestões de rota.
 */
export function montarOpcoes(comando: Comando | null, query: string, hoje: string): Opcao[] {
  if (comando === null) {
    return sugerirRotas(query).map((r) => opcaoDeRota(r.rota, r.rotulo));
  }
  if (comando.tipo === "transacao") return [opcaoDeTransacao(comando, hoje)];
  if (comando.tipo === "navegacao") return [opcaoDeRota(comando.rota, comando.rotulo)];
  return [];
}

/** Mantém o índice dentro da lista quando ela encolhe sob o cursor. */
export function indiceValido(ativo: number, total: number): number {
  return Math.min(ativo, Math.max(total - 1, 0));
}
