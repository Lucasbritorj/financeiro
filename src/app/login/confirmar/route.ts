import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  if (code && code.length <= 2048) {
    try {
      // Destino relativo mantém a origem visível no navegador mesmo atrás
      // de proxy, onde request.url pode conter o hostname interno.
      const resposta = new NextResponse(null, { status: 303, headers: {
        Location: "/login/nova-senha", "Cache-Control": "private, no-store",
      } });
      const supabase = await createClient(resposta);
      const { error } = await supabase.auth.exchangeCodeForSession(code);
      if (!error) return resposta;
    } catch { /* O link pode expirar ou a rede falhar: ofereça recuperação. */ }
  }
  return new NextResponse(null, { status: 303, headers: {
    Location: "/login/recuperar?erro=link", "Cache-Control": "private, no-store",
  } });
}
