"use client";

// Container do fluxo de importação de extrato. Só compõe: o estado e as RPCs
// vivem em use-importacao.ts, a leitura do arquivo em lib/leitura-arquivo.ts,
// e as duas telas são componentes de apresentação puros.

import { useImportacao } from "./use-importacao";
import { PainelUpload } from "./painel-upload";
import { TabelaRevisao, type CategoriaOpcao } from "./tabela-revisao";

export default function ImportadorCsv({ categorias }: { categorias: CategoriaOpcao[] }) {
  const {
    preset,
    setPreset,
    etapa,
    pendente,
    erro,
    aviso,
    processarArquivo,
    alternarIgnorar,
    mudarCategoria,
    confirmar,
    descartar,
  } = useImportacao();

  if (etapa.fase === "upload") {
    return (
      <PainelUpload
        preset={preset}
        onPreset={setPreset}
        onArquivo={processarArquivo}
        pendente={pendente}
        erro={erro}
        aviso={aviso}
      />
    );
  }

  return (
    <TabelaRevisao
      linhas={etapa.linhas}
      descartadasParse={etapa.descartadasParse}
      categorias={categorias}
      erro={erro}
      pendente={pendente}
      onAlternarIgnorar={alternarIgnorar}
      onMudarCategoria={mudarCategoria}
      onConfirmar={confirmar}
      onDescartar={descartar}
    />
  );
}
