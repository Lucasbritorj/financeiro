import { ImageResponse } from "next/og";

export const runtime = "edge";

// Maskable: o SO recorta em formatos variados (círculo, squircle...), então
// o conteúdo relevante precisa caber na "safe zone" central (~80% do
// tamanho) — daí a letra bem menor que nos ícones normais, e fundo opaco
// preenchendo tudo (maskable não pode ter transparência nas bordas).
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
            fontSize: 180,
            fontFamily: "Georgia, serif",
            fontStyle: "italic",
            color: "#d9a24e",
          }}
        >
          A
        </span>
      </div>
    ),
    { width: 512, height: 512 },
  );
}
