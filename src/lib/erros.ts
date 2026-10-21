// Erros das RPCs chegam com hint de remediação (padrão FW4xx do backend).
// Fonte única da formatação — não repetir a concatenação nos componentes.
//
// O parâmetro é `unknown` porque a maior parte das chamadas vem de `catch`, e
// `catch (e)` produz `unknown` em TS estrito. Com a assinatura antiga
// (`ErroComHint`) o build quebrava em use-importacao.ts:76 e :202 — dois
// `catch` que precisavam justamente desta função. Estreitar aqui, na borda,
// conserta os dois e qualquer `catch` futuro; castar no call site só espalharia
// o problema.

export type ErroComHint = { message: string; hint?: string | null; code?: string };

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
  const auth: Record<string,string> = {
    invalid_credentials: 'E-mail ou senha inválidos.',
    email_not_confirmed: 'Confirme seu e-mail antes de entrar.',
    over_request_rate_limit: 'Muitas tentativas. Aguarde antes de tentar novamente.',
    over_email_send_rate_limit: 'Aguarde antes de solicitar outro e-mail.',
    weak_password: 'Escolha uma senha mais forte.',
    same_password: 'Escolha uma senha diferente da atual.',
    otp_expired: 'O link expirou. Solicite outro link.',
    user_already_exists: 'Confira seu e-mail ou recupere o acesso à sua conta.',
  };
  if(error.code && Object.hasOwn(auth,error.code))return auth[error.code];
  // Somente erros de negócio controlados pelas RPCs podem chegar à interface.
  if(!/^FW4\d{2}$/.test(error.code??'')||/\bSELECT\b/i.test(error.message))return 'Erro inesperado. Tente de novo.';
  return error.hint ? `${error.message} ${error.hint}` : error.message;
}
