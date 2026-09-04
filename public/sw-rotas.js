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
  // O bump é a correção, não cosmética: o handler de `activate` apaga todo cache
  // cujo nome difere do atual, então trocar o nome é o que purga conteúdo já
  // gravado nos navegadores. Mudar só a lógica deixaria o conteúdo velho lá.
  //
  // v1 -> v2: HTML de rota protegida gravado por engano pela primeira versão.
  // v2 -> v3: HTML de /transacoes gravado sob a chave "/" ou "/login". A entrada
  // na whitelist decide pelo pathname PEDIDO, e as duas rotas públicas entregam
  // /transacoes a quem tem sessão — ver o comentário de ROTAS_PUBLICAS abaixo e
  // a checagem de `resposta.redirected` no sw.js.
  const NOME_CACHE = "atelie-v3";

  // Só o que é igual para todo mundo, logado ou não — MAS a lista sozinha não
  // basta, e é importante saber por quê. Ela julga o pathname pedido; o cache
  // guarda o corpo entregue, e o fetch segue redirect. Hoje NENHUMA das duas
  // entradas serve uma página própria a quem tem sessão: "/" faz
  // redirect("/transacoes") em src/app/page.tsx, e "/login" é mandado para
  // /transacoes pelo src/proxy.ts. Quem impede a gravação do HTML privado é a
  // checagem `!resposta.redirected` no sw.js; esta lista é a segunda camada, não
  // a primeira. Rota nova aqui precisa das duas coisas: ser pública E responder
  // por si, sem redirect.
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

  /**
   * Decisão final de gravar uma navegação no cache. Mora aqui, e não embutida no
   * handler do sw.js, pelo mesmo motivo que podeCachearNavegacao: assim o teste
   * EXECUTA a decisão com respostas sintéticas, em vez de procurar um `if` no
   * texto do service worker. Um assert por regex confirma que a linha existe;
   * não confirma que ela decide certo.
   *
   * As três condições, e o que cada uma impede:
   * - pathname público: HTML de rota protegida nunca entra no cache.
   * - `ok`: fetch só rejeita em falha de rede, então um 500 durante deploy
   *   resolveria normalmente e viraria a "última tela boa" do fallback.
   * - `!redirected`: o pathname pedido não é o conteúdo entregue. As duas rotas
   *   públicas redirecionam para /transacoes quando há sessão, e sem esta
   *   condição o HTML privado é gravado sob a chave "/" ou "/login".
   *
   * @param {string} pathname da REQUEST (não da resposta)
   * @param {{ok: boolean, redirected: boolean}} resposta
   * @returns {boolean}
   */
  function podeGravarNavegacao(pathname, resposta) {
    if (!podeCachearNavegacao(pathname)) return false;
    if (!resposta || typeof resposta !== "object") return false;
    return resposta.ok === true && resposta.redirected !== true;
  }

  const api = { NOME_CACHE, ROTAS_PUBLICAS, podeCachearNavegacao, podeGravarNavegacao };

  // Service worker carrega por importScripts (sem module); o teste carrega por
  // require. O guard deixa o mesmo arquivo servir aos dois.
  raiz.SWRotas = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof self !== "undefined" ? self : globalThis);
