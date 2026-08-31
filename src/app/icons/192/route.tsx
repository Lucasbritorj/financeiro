import { ImageResponse } from "next/og";

export const runtime = "edge";

// Ícone do app para o manifest do PWA (Android home screen, task switcher).
// Gerado via next/og em vez de arquivo estático: reusa a paleta do app
// (--tinta / --ouro em globals.css) sem depender de ferramenta externa de
// conversão SVG -> PNG.
export async function GET() {
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
            fontSize: 110,
            fontFamily: "Georgia, serif",
            fontStyle: "italic",
            color: "#d9a24e",
          }}
        >
          A
        </span>
      </div>
    ),
    { width: 192, height: 192 },
  );
}
