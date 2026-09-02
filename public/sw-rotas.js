// Decisão "esta navegação pode ir para o cache?" — separada do sw.js para poder
// ser testada de verdade (tests/unit/sw-cache-navegacao.test.ts), em vez de
// verificada por leitura do texto do service worker.
//
// POR QUE WHITELIST, E NÃO LISTA DE ROTAS PROTEGIDAS
//
// O HTML das rotas de (protegido) é renderizado no servidor com os dados reais
// do usuário embutidos — /transacoes traz descrição, valor e data direto no
// documento. O Cache Storage é uma única entrada por URL, por origem, e não
// distingue sessão: `Cookie` é forbidden header e não chega ao fetch event, então
// não há como particionar por usuário. Cachear esse HTML significa que o próximo
// usuário do mesmo navegador pode recebê-lo.
//
// Com blacklist, uma rota protegida nova nasceria cacheável até alguém lembrar de
// adicioná-la. Com whitelist, nasce segura e só entra no cache por decisão
// explícita. O custo é offline mais pobre nas telas internas — preço correto:
// o projeto trata vazamento entre usuários como invariante de primeira classe
// (RLS em toda leitura, `security_invoker=true` nas views), e o service worker
// não pode ser a camada que fura isso na entrega.

(function (raiz) {
  // v2, e o bump é a correção — não cosmética. Quem já abriu o app com a versão
  // anterior tem HTML de rota protegida gravado em "atelie-v1"; mudar só a lógica
  // deixaria esse conteúdo lá. O handler de `activate` apaga todo cache cujo nome
  // difere do atual, então trocar o nome é o que purga o cache contaminado.
  const NOME_CACHE = "atelie-v2";

  // Só o que é igual para todo mundo, logado ou não.
  const ROTAS_PUBLICAS = ["/", "/login"];

  /**
   * @param {string} pathname
   * @returns {boolean} true só para navegação sem dado de usuário no HTML.
   */
  function podeCachearNavegacao(pathname) {
    if (typeof pathname !== "string" || pathname === "") return false;
    // Normaliza barra final: "/login/" e "/login" são a mesma rota.
    const limpo = pathname.length > 1 && pathname.endsWith("/")
      ? pathname.slice(0, -1)
      : pathname;
    return ROTAS_PUBLICAS.includes(limpo);
  }

  const api = { NOME_CACHE, ROTAS_PUBLICAS, podeCachearNavegacao };

  // Service worker carrega por importScripts (sem module); o teste carrega por
  // require. O guard deixa o mesmo arquivo servir aos dois.
  raiz.SWRotas = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof self !== "undefined" ? self : globalThis);
