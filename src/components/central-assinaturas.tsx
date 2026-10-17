"use client";

import {
  GerenciadorAssinaturas,
  ImpactoPorCartao,
  ProximasCobrancas,
  ResumoAssinaturas,
} from "@/components/central-assinaturas-ui";
import {
  type CartaoOpcao,
  type CategoriaOpcao,
  useCentralAssinaturas,
} from "@/components/use-central-assinaturas";

export default function CentralAssinaturas({
  categorias,
  cartoes,
}: {
  categorias: CategoriaOpcao[];
  cartoes: CartaoOpcao[];
}) {
  const central = useCentralAssinaturas();

  if (central.indisponivel) return <p role="alert" className="vidro-soberano p-4 text-sm">
    Central de Assinaturas indisponível nesta instalação. Contate o responsável pelo aplicativo.
  </p>;

  if (central.assinaturas === null) return <div className="vidro-soberano grid gap-3 p-4">
    {central.erro ? <p role="alert">Não foi possível carregar as assinaturas: {central.erro}</p> : <p role="status">Carregando assinaturas…</p>}
    {central.erro && <button type="button" className="botao-fantasma" onClick={() => void central.recarregar()}>Tentar novamente</button>}
  </div>;

  return (
    <div className="grid gap-6">
      {central.erro && <p role="alert">Não foi possível atualizar as assinaturas: {central.erro}. Exibindo a última consulta completa.</p>}
      <ResumoAssinaturas assinaturas={central.assinaturas} />
      <ImpactoPorCartao assinaturas={central.assinaturas} cartoes={cartoes} />
      <ProximasCobrancas assinaturas={central.assinaturas} cartoes={cartoes} />
      <GerenciadorAssinaturas {...central} categorias={categorias} cartoes={cartoes} />
    </div>
  );
}
