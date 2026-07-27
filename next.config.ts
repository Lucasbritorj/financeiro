import type { NextConfig } from "next";

// Origem do Supabase para o connect-src da CSP (REST + Realtime websocket).
// Fallback amplo só para builds sem env (ex.: CI) — em runtime real o valor
// vem de NEXT_PUBLIC_SUPABASE_URL.
const supabaseOrigin = (() => {
  try {
    return new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").origin;
  } catch {
    return "https://*.supabase.co";
  }
})();

// 'unsafe-inline'/'unsafe-eval' em script-src: exigência do runtime do
// Next sem infraestrutura de nonce — a CSP ainda bloqueia QUALQUER origem
// externa de script/estilo/frame. Endurecer com nonces = mudança
// arquitetural (escalada no relatório de auditoria).
const csp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self' data:",
  `connect-src 'self' ${supabaseOrigin} ${supabaseOrigin.replace("https://", "wss://")}`,
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          // Só origens explícitas executam/conectam; iframe proibido.
          { key: "Content-Security-Policy", value: csp },
          // App não deve ser embutido em iframe (clickjacking).
          { key: "X-Frame-Options", value: "DENY" },
          // Navegador não deve adivinhar MIME types.
          { key: "X-Content-Type-Options", value: "nosniff" },
          // Não vazar URL interna em navegação externa.
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          // Sem acesso a sensores/permissões que o app não usa.
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
