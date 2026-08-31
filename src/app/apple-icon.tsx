import { ImageResponse } from "next/og";

export const runtime = "edge";
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

// Convenção nativa do Next.js: serve automaticamente em /apple-icon e é o
// que o iOS usa como ícone ao "Adicionar à Tela de Início" (Safari não lê
// o manifest.icons para isso, só essa tag/rota).
export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#161311",
        }}
      >
        <span
          style={{
            fontSize: 100,
            fontFamily: "Georgia, serif",
            fontStyle: "italic",
            color: "#d9a24e",
          }}
        >
          A
        </span>
      </div>
    ),
    size,
  );
}
