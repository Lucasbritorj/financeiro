import type { MetadataRoute } from "next";

// Convenção nativa do Next.js App Router: serve automaticamente em
// /manifest.webmanifest com o content-type correto.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Ateliê — seu dinheiro, com clareza",
    short_name: "Ateliê",
    description: "Assistente financeiro pessoal: categorias, insights e planejamento",
    start_url: "/",
    display: "standalone",
    background_color: "#161311",
    theme_color: "#161311",
    orientation: "portrait-primary",
    icons: [
      { src: "/icons/192", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/512", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
