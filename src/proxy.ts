import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { fetchComTimeout } from "./lib/supabase/fetch";
import { criarNonce, criarPoliticaScripts } from "./lib/csp";
import { opcoesCookieSessao } from './lib/seguranca-http';

// Renova a sessão Supabase a cada request e protege as rotas do app.
export async function proxy(request: NextRequest) {
  const nonce = criarNonce();
  const csp = criarPoliticaScripts(nonce, process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NODE_ENV === 'development');
  const requestHeaders = new Headers(request.headers);
  // Sempre substituir valores recebidos do cliente antes de renderizar o Next.
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('Content-Security-Policy', csp);
  let response = NextResponse.next({ request: { headers: requestHeaders } });
  function concluir(destino: NextResponse = response) {
    if (destino !== response) {
      for (const cookie of response.cookies.getAll()) destino.cookies.set(cookie);
    }
    destino.headers.set('Content-Security-Policy', csp);
    destino.headers.set('Cache-Control', 'private, no-store');
    return destino;
  }

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookieOptions: opcoesCookieSessao(),
      global: { fetch: fetchComTimeout },
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          requestHeaders.set('cookie', request.headers.get('cookie') ?? '');
          response = NextResponse.next({ request: { headers: requestHeaders } });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, {...options,...opcoesCookieSessao()})
          );
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();
  // Endurecer também sessões anteriores que não precisaram renovar o JWT.
  if(user)for(const cookie of request.cookies.getAll()){
    if(/^sb-[a-z0-9-]+-auth-token(?:\.\d+)?$/.test(cookie.name)&&!response.cookies.has(cookie.name))
      response.cookies.set(cookie.name,cookie.value,{...opcoesCookieSessao(),maxAge:30*24*60*60});
  }

  const caminho = request.nextUrl.pathname;
  const ehLogin = caminho === "/login";
  const ehRecuperacao = ["/login/recuperar", "/login/confirmar", "/login/nova-senha"].includes(caminho);

  // As duas APIs de sessão/dados e Pluggy validam sua própria autenticação.
  const ehApi=['/api/auth','/api/pluggy'].includes(caminho)||caminho.startsWith('/api/dados/');
  if (!user && !ehLogin && !ehRecuperacao && !ehApi) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return concluir(NextResponse.redirect(url));
  }
  if (user && ehLogin) {
    const url = request.nextUrl.clone();
    url.pathname = "/transacoes";
    return concluir(NextResponse.redirect(url));
  }

  return concluir();
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
    //
    // robots.txt pela mesma razão do manifest: é lido sem sessão. Interceptado,
    // /robots.txt responde 200 com o HTML de /login — o Lighthouse lê isso como
    // robots.txt malformado e reprova a auditoria de SEO. Verificado em
    // 10/09/2026: `curl /robots.txt` devolvia a página de login.
    //
    // Todo ponto aqui vai escapado. Dentro do grupo, o path-to-regexp do Next
    // passa o conteúdo verbatim — é o que faz o lookahead funcionar —, então um
    // ponto solto é curinga: `favicon.ico` sem escape também dispensava do proxy
    // qualquer coisa começando em `/faviconXico`. Não havia rota alcançável por
    // ali, mas é dispensa de checagem de sessão concedida por acidente de regex.
    "/((?!_next/static|_next/image|ocr/(?:worker\\.min\\.js|tesseract-core(?:-(?:lstm|simd|relaxedsimd))*\\.wasm(?:\\.js)?|por\\.traineddata\\.gz)$|favicon\\.ico|robots\\.txt|sw\\.js|sw-rotas\\.js|manifest\\.webmanifest|icons/|apple-icon|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
