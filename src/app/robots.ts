import type { MetadataRoute } from "next";

// App financeiro pessoal: nada aqui deve ser indexado. Todas as rotas úteis
// exigem sessão, e /login não tem valor de busca.
//
// Existe também por um motivo mecânico: sem este arquivo, `/robots.txt` cai no
// 404 do App Router e devolve HTML. O Lighthouse lê isso como robots.txt
// malformado e reprova a auditoria de SEO (era a única falha em 10/09/2026).
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", disallow: "/" },
  };
}
