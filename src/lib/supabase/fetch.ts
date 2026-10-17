/** Limita espera de autenticação/RPC sem repetir escritas automaticamente. */
export const fetchComTimeout: typeof fetch = (input, init = {}) => {
  const timeout = AbortSignal.timeout(15000);
  const sinal = init.signal ?? (input instanceof Request ? input.signal : null);
  return fetch(input, { ...init, signal: sinal ? AbortSignal.any([sinal, timeout]) : timeout });
};
