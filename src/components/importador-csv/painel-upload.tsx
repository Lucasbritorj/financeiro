"use client";

import { PRESETS, type PresetBanco } from "@/lib/csv";

type Props = {
  preset: PresetBanco;
  onPreset: (preset: PresetBanco) => void;
  onArquivo: (arquivo: File) => void;
  pendente: boolean;
  erro: string | null;
  aviso: string | null;
};

export function PainelUpload({ preset, onPreset, onArquivo, pendente, erro, aviso }: Props) {
  function aoEscolherArquivo(e: React.ChangeEvent<HTMLInputElement>) {
    const arquivo = e.target.files?.[0];
    if (arquivo) onArquivo(arquivo);
    // Sempre limpa: reescolher o mesmo arquivo tem de disparar o change de novo.
    e.target.value = "";
  }

  return (
    <div className="grid gap-4">
      <div className="vidro-soberano grid gap-3 p-5">
        <label className="text-sm">
          Banco / formato (usado só para CSV)
          <select
            value={preset}
            onChange={(e) => onPreset(e.target.value as PresetBanco)}
            className="campo-soberano"
          >
            {PRESETS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.rotulo}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          Arquivo do extrato (CSV, OFX, OFC, XLSX ou PDF)
          <input
            type="file"
            accept=".csv,.ofx,.ofc,.xlsx,.pdf,text/csv"
            onChange={aoEscolherArquivo}
            disabled={pendente}
            className="campo-soberano"
          />
        </label>
        <p className="text-xs" style={{ color: "var(--grafite)" }}>
          O arquivo é lido no seu navegador; só as linhas (data, valor,
          descrição) vão para o servidor, em uma área de revisão — nada entra
          direto no seu histórico. OFX/OFC é o export padrão dos bancos e o
          mais confiável. PDF é melhor-esforço: linha sem sinal entra como
          despesa (marcador “C” vira receita) — confira na revisão antes de
          importar.
        </p>
        {erro && (
          <p className="text-sm" style={{ color: "var(--telha)" }}>
            {erro}
          </p>
        )}
        {aviso && (
          <p className="text-sm" style={{ color: "var(--ouro)" }}>
            {aviso}
          </p>
        )}
        {pendente && (
          <p className="text-sm" style={{ color: "var(--grafite)" }}>
            Processando...
          </p>
        )}
      </div>
    </div>
  );
}
