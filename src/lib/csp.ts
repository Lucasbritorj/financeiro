/** Autorização imprevisível, independente em cada resposta HTML. */
export function criarNonce(): string {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(24))).toString('base64');
}

export function criarPoliticaScripts(nonce: string, supabaseUrl: string | undefined, desenvolvimento: boolean): string {
  if (!/^[A-Za-z0-9+/]{32}$/.test(nonce)) throw new Error('Nonce inválido.');
  let conexoes = "'self'";
  if (supabaseUrl) {
    const url = new URL(supabaseUrl);
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if ((url.protocol !== 'https:' && !(local && url.protocol === 'http:')) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
      throw new Error('Origem Supabase inválida.');
    }
    conexoes += ` ${url.origin} ${url.origin.replace(/^http/, 'ws')}`;
  }
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' 'wasm-unsafe-eval'${desenvolvimento ? " 'unsafe-eval'" : ''}`,
    "script-src-attr 'none'",
    // O aplicativo usa style props em gráficos, cores e layout. Não autoriza scripts.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:", "font-src 'self' data:",
    `connect-src ${conexoes}`,
    "worker-src 'self' blob:",
    "frame-ancestors 'none'", "base-uri 'self'", "form-action 'self'", "object-src 'none'",
  ].join('; ');
}
