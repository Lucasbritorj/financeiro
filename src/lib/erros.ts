// Erros das RPCs chegam com hint de remediação (padrão FW4xx do backend).
// Fonte única da formatação — não repetir a concatenação nos componentes.

type ErroComHint = { message: string; hint?: string | null };

export function mensagemDeErro(error: ErroComHint): string {
  return error.hint ? `${error.message} ${error.hint}` : error.message;
}
