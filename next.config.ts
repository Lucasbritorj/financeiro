import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
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
