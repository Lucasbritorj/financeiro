// Erros das RPCs chegam com hint de remediação (padrão FW4xx do backend).
// Fonte única da formatação — não repetir a concatenação nos componentes.
//
// O parâmetro é `unknown` porque a maior parte das chamadas vem de `catch`, e
// `catch (e)` produz `unknown` em TS estrito. Com a assinatura antiga
// (`ErroComHint`) o build quebrava em use-importacao.ts:76 e :202 — dois
// `catch` que precisavam justamente desta função. Estreitar aqui, na borda,
// conserta os dois e qualquer `catch` futuro; castar no call site só espalharia
// o problema.

type ErroComHint = { message: string; hint?: string | null };

function temMensagem(e: unknown): e is ErroComHint {
  return (
    typeof e === "object" &&
    e !== null &&
    "message" in e &&
    typeof (e as { message: unknown }).message === "string"
  );
}

export function mensagemDeErro(error: unknown): string {
  if (!temMensagem(error)) {
    // Nada lançável foi reconhecido (string solta, throw de valor primitivo,
    // rejeição sem Error). Mensagem genérica em vez de "undefined" na tela.
    return "Erro inesperado. Tente de novo.";
  }
  return error.hint ? `${error.message} ${error.hint}` : error.message;
}
