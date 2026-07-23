import { fetchIndicadoresBcb } from "@/lib/bcb";

// Letreiro de pregão: indicadores do Banco Central passando em marquee no
// topo do dashboard. Server Component — o fetch (cacheado 1h) roda no
// servidor; o movimento é CSS puro (sem JS no cliente). O conteúdo é
// duplicado para o loop ser contínuo; a cópia é aria-hidden e some quando
// prefers-reduced-motion desliga a animação (vira faixa estática rolável).

export default async function LetreiroBcb() {
  const { indicadores, falhas } = await fetchIndicadoresBcb();

  if (indicadores.length === 0) {
    return (
      <div className="letreiro letreiro-vazio" role="status">
        Indicadores do Banco Central indisponíveis agora (API SGS fora do ar ou sem rede).
      </div>
    );
  }

  const itens = (ariaHidden: boolean) => (
    <ul className={`letreiro-grupo${ariaHidden ? " letreiro-copia" : ""}`} aria-hidden={ariaHidden}>
      {indicadores.map((ind) => (
        <li key={ind.rotulo} className="letreiro-item">
          <span className="letreiro-rotulo">{ind.rotulo}</span>
          <span className="numero-soberano letreiro-valor">{ind.valor}</span>
          <span className="letreiro-referencia">{ind.referencia}</span>
        </li>
      ))}
      {falhas.length > 0 && (
        <li className="letreiro-item letreiro-referencia">sem dados: {falhas.join(", ")}</li>
      )}
    </ul>
  );

  // Velocidade proporcional ao conteúdo: ~5s por indicador.
  const duracao = `${(indicadores.length + (falhas.length ? 1 : 0)) * 5}s`;

  return (
    <div className="letreiro" aria-label="Indicadores econômicos do Banco Central">
      <div className="letreiro-trilho" style={{ animationDuration: duracao }}>
        {itens(false)}
        {itens(true)}
      </div>
    </div>
  );
}
