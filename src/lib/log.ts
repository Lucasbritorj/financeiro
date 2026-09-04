// Ponto único de saída de diagnóstico do app. Existe por duas razões: dar um
// lugar para plugar um coletor (Sentry e afins) sem caçar `console` pelo
// código, e distinguir o que serve ao usuário-final do que serve a quem
// desenvolve.
//
// Não é uma biblioteca de log: não tem níveis configuráveis, transporte, nem
// formatação. O projeto tem dois pontos de diagnóstico; qualquer coisa além
// disto seria estrutura sem demanda.
//
// A alternativa considerada foi @sentry/nextjs. Ficou para quando houver
// demanda real de observabilidade — traz DSN, configuração de build e
// upload de sourcemap, o que não se paga por dois call sites. Quando entrar,
// entra aqui dentro, e nenhum chamador muda.

/** Lido a cada chamada, não na carga do módulo, para ser testável. */
function ehProducao(): boolean {
  return process.env.NODE_ENV === "production";
}

/** Evita imprimir um segundo argumento vazio quando não há causa. */
function extras(causa: unknown): unknown[] {
  return causa === undefined ? [] : [causa];
}

export const log = {
  /**
   * Falha que atrapalhou algo de verdade. Sai em qualquer ambiente: em
   * produção é o que sobra para diagnosticar pelo console do navegador.
   */
  erro(mensagem: string, causa?: unknown): void {
    console.error(mensagem, ...extras(causa));
  },

  /**
   * Recado para quem desenvolve — configuração faltando, migration não
   * aplicada, estado de instalação conhecido. Silencioso em produção: o
   * usuário final não tem o que fazer com "aplique a migration 0015", e o
   * console dele não é lugar de recado interno.
   */
  aviso(mensagem: string, causa?: unknown): void {
    if (ehProducao()) return;
    console.warn(mensagem, ...extras(causa));
  },
};
