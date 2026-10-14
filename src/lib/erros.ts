// Erros das RPCs chegam com hint de remediação (padrão FW4xx do backend).
// Fonte única da formatação – não repetir a concatenação nos componentes.

type ErroComHint = { message: string; hint?: string | null };

const PADRAO_INTERNO_SENSIVEL =
    /(?:\bat\s+[^\n]+\([^)]+:\d+:\d+\)|\b(?:SELECT|INSERT\s+INTO|UPDATE|DELETE\s+FROM|DROP\s+TABLE)\b|relation\s+"[^"]+"\s+does\s+not\s+exist|syntax\s+error\s+at\s+or\s+near)/i;

function temMensagem(e: unknown): e is ErroComHint {
    return (
          typeof e === "object" &&
          e !== null &&
          "message" in e &&
          typeof (e as { message: unknown }).message === "string"
        );
}

export function mensagemDeErro(error: unknown): string {
    if (!temMensagem(error) || PADRAO_INTERNO_SENSIVEL.test(error.message)) {
          return "Erro inesperado. Tente de novo.";
    }
    const hint =
          typeof error.hint === "string" && !PADRAO_INTERNO_SENSIVEL.test(error.hint)
        ? error.hint
            : null;
    return hint ? `${error.message} ${hint}` : error.message;
}

export function mensagemDeErroAuth(
    error: unknown,
    modo: "entrar" | "cadastrar",
  ): string {
    if (temMensagem(error) && /rate\s*limit|too\s*many\s*requests/i.test(error.message)) {
          return "Muitas tentativas em sequência. Aguarde antes de tentar novamente.";
    }
    return modo === "entrar"
      ? "Credenciais inválidas. Verifique seu e-mail e senha."
          : "Não foi possível concluir o cadastro. Verifique os dados e tente novamente.";
}
