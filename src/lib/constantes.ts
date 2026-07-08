// Tetos e limites compartilhados da UI. Os tetos DUROS vivem no banco e
// não podem ser contornados por aqui (0002: 120 parcelas máx; 0005: 20
// cartões ativos máx) — a UI usa valores menores ou iguais aos do servidor.

/** Máximo de parcelas oferecido no formulário (servidor aceita até 120). */
export const MAX_PARCELAS_UI = 48;

/** Página inicial de transações: itens mais recentes. */
export const LIMITE_TRANSACOES_LISTA = 20;

/** Faturas listadas por página (mais recentes primeiro). */
export const LIMITE_FATURAS_LISTA = 24;

/** Espelha o teto de cartões ativos do servidor (criar_cartao). */
export const LIMITE_CARTOES_LISTA = 20;

/** Página de transações: itens por página do cursor keyset (0007). */
export const TAMANHO_PAGINA_TRANSACOES = 20;

/** Espelha o teto de linhas por importação do servidor (criar_importacao). */
export const LIMITE_LINHAS_IMPORTACAO = 1000;
