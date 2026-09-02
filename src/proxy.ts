import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// Renova a sessão Supabase a cada request e protege as rotas do app.
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const ehLogin = request.nextUrl.pathname.startsWith("/login");

  if (!user && !ehLogin) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }
  if (user && ehLogin) {
    const url = request.nextUrl.clone();
    url.pathname = "/transacoes";
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  matcher: [
    // sw.js/sw-rotas.js/manifest/icons precisam ser servidos SEM redirect
    // mesmo deslogado: o browser recusa registrar um service worker cuja URL
    // devolve redirect (SecurityError), e o manifest é lido antes de
    // qualquer sessão existir (instalar o PWA não exige login).
    //
    // sw-rotas.js entra aqui porque o sw.js o carrega por importScripts, que
    // recusa redirect e recusa MIME que não seja JavaScript. Interceptado, ele
    // devolve o HTML de /login e a avaliação do script inteiro lança: o SW não
    // instala, o handler de `activate` não roda, e o cache gravado pela versão
    // anterior nunca é purgado. A falha é silenciosa do lado do servidor — o
    // /sw.js continua respondendo 200, e só o console do navegador acusa.
    "/((?!_next/static|_next/image|favicon.ico|sw\\.js|sw-rotas\\.js|manifest\\.webmanifest|icons/|apple-icon|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
