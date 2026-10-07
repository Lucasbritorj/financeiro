"use client";

import {
  GerenciadorAssinaturas,
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

  return (
    <div className="grid gap-6">
      <ResumoAssinaturas assinaturas={central.assinaturas ?? []} />

      {central.indisponivel ? (
        <p className="vidro-soberano p-4 text-sm" style={{ color: "var(--ouro)" }}>
          Central de Assinaturas indisponível: aplique a migration
          {" "}20261006120000_central_assinaturas.sql.
        </p>
      ) : (
        <>
          <ProximasCobrancas
            assinaturas={central.assinaturas ?? []}
            cartoes={cartoes}
          />
          <GerenciadorAssinaturas
            {...central}
            categorias={categorias}
            cartoes={cartoes}
          />
        </>
      )}
    </div>
  );
}
