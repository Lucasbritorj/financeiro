"use client";

// Container do fluxo de importação de extrato. Só compõe: o estado e as RPCs
// vivem em use-importacao.ts, a leitura do arquivo em lib/leitura-arquivo.ts,
// e as duas telas são componentes de apresentação puros.

import { useImportacao } from "./use-importacao";
import { PainelUpload } from "./painel-upload";
import { TabelaRevisao, type CategoriaOpcao } from "./tabela-revisao";
import { useState } from 'react';
import ImportadorFatura from '../importador-fatura';

export default function ImportadorCsv({ categorias, cartoes=[] }: { categorias: CategoriaOpcao[]; cartoes?:{id:string;nome:string}[] }) {
  const [modo,setModo]=useState('extrato');
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
      <div className="grid gap-4">
      <label className="text-sm">O que você quer importar?<select className="campo-soberano" value={modo} onChange={e=>setModo(e.target.value)} disabled={pendente}>
        <option value="extrato">Extrato bancário</option><option value="fatura">Fatura de cartão</option>
      </select></label>
      {modo==='fatura'?<ImportadorFatura cartoes={cartoes} categorias={categorias}/>:
      <PainelUpload
        preset={preset}
        onPreset={setPreset}
        onArquivo={processarArquivo}
        pendente={pendente}
        erro={erro}
        aviso={aviso}
      />
      }</div>
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
