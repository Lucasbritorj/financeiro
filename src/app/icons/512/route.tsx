import { ImageResponse } from "next/og";

export const runtime = "edge";

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
            fontSize: 290,
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
