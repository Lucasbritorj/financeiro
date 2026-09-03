"use client";

import { formatarCentavos, formatarData } from "@/lib/money";
import { calcularResumoRevisao, type LinhaRevisao } from "@/lib/importacao-preview";

export type CategoriaOpcao = { id: string; nome: string; tipo: string };

type LinhaProps = {
  linha: LinhaRevisao;
  categorias: CategoriaOpcao[];
  onAlternarIgnorar: (linha: LinhaRevisao) => void;
  onMudarCategoria: (linha: LinhaRevisao, categoriaId: string) => void;
};

function LinhaDaRevisao({
  linha: l,
  categorias,
  onAlternarIgnorar,
  onMudarCategoria,
}: LinhaProps) {
  const ehDespesa = l.valor < 0;
  return (
    <tr
      className="border-t"
      style={{ borderColor: "var(--borda)", opacity: l.ignorar ? 0.45 : 1 }}
    >
      <td className="px-2 py-2">
        <input
          type="checkbox"
          checked={!l.ignorar}
          onChange={() => onAlternarIgnorar(l)}
          aria-label={`Importar ${l.descricao}`}
        />
      </td>
      <td className="numero-soberano px-2 py-2 whitespace-nowrap">{formatarData(l.data)}</td>
      <td className="px-2 py-2">
        {l.descricao}
        {l.duplicada && (
          <span className="ml-2 text-xs" style={{ color: "var(--ouro)" }}>
            possível duplicada
          </span>
        )}
      </td>
      <td className="px-2 py-2">
        {ehDespesa ? (
          <select
            value={l.categoria_sugerida ?? ""}
            onChange={(e) => onMudarCategoria(l, e.target.value)}
            className="campo-soberano !mt-0 py-1 text-xs"
            aria-label={`Categoria de ${l.descricao}`}
          >
            <option value="">Sem categoria</option>
            {categorias
              .filter((c) => c.tipo === "DESPESA")
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nome}
                </option>
              ))}
          </select>
        ) : (
          <span style={{ color: "var(--grafite)" }}>receita</span>
        )}
      </td>
      <td
        className="numero-soberano px-2 py-2 text-right whitespace-nowrap"
        style={{ color: ehDespesa ? "var(--giz)" : "var(--verde)" }}
      >
        {ehDespesa ? "-" : "+"}
        {formatarCentavos(Math.abs(l.valor))}
      </td>
    </tr>
  );
}

type ResumoProps = { linhas: LinhaRevisao[]; descartadasParse: number };

function ResumoDaRevisao({ linhas, descartadasParse }: ResumoProps) {
  const { aImportar, novos, duplicadas, ambiguos } = calcularResumoRevisao(linhas);
  return (
    <div
      className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm"
      style={{ color: "var(--grafite)" }}
    >
      <span>
        <b style={{ color: "var(--giz)" }}>{linhas.length}</b> linhas ·{" "}
        <b style={{ color: "var(--giz)" }}>{novos}</b> nova(s) ·{" "}
        <b style={{ color: "var(--giz)" }}>{aImportar}</b> serão importadas
      </span>
      {duplicadas > 0 && (
        <span style={{ color: "var(--ouro)" }}>
          {duplicadas} já existe(m) no seu histórico — não serão gravadas
        </span>
      )}
      {ambiguos > 0 && (
        <span style={{ color: "var(--ouro)" }}>
          {ambiguos} com mesma data e valor de algo que você já tem, mas
          descrição diferente — marque para importar mesmo assim
        </span>
      )}
      {descartadasParse > 0 && (
        <span>{descartadasParse} linha(s) do arquivo não reconhecida(s)</span>
      )}
    </div>
  );
}

type Props = {
  linhas: LinhaRevisao[];
  descartadasParse: number;
  categorias: CategoriaOpcao[];
  erro: string | null;
  pendente: boolean;
  onAlternarIgnorar: (linha: LinhaRevisao) => void;
  onMudarCategoria: (linha: LinhaRevisao, categoriaId: string) => void;
  onConfirmar: () => void;
  onDescartar: () => void;
};

export function TabelaRevisao({
  linhas,
  descartadasParse,
  categorias,
  erro,
  pendente,
  onAlternarIgnorar,
  onMudarCategoria,
  onConfirmar,
  onDescartar,
}: Props) {
  // DUPLICADO nunca grava, mesmo desmarcado — o botão espelha o servidor.
  const { aImportar } = calcularResumoRevisao(linhas);

  return (
    <div className="grid gap-4">
      <ResumoDaRevisao linhas={linhas} descartadasParse={descartadasParse} />

      {erro && (
        <p className="text-sm" style={{ color: "var(--telha)" }}>
          {erro}
        </p>
      )}

      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr style={{ color: "var(--grafite)" }} className="text-left">
              <th className="px-2 py-2 font-normal">Importar</th>
              <th className="px-2 py-2 font-normal">Data</th>
              <th className="px-2 py-2 font-normal">Descrição</th>
              <th className="px-2 py-2 font-normal">Categoria</th>
              <th className="px-2 py-2 text-right font-normal">Valor</th>
            </tr>
          </thead>
          <tbody>
            {linhas.map((l) => (
              <LinhaDaRevisao
                key={l.id}
                linha={l}
                categorias={categorias}
                onAlternarIgnorar={onAlternarIgnorar}
                onMudarCategoria={onMudarCategoria}
              />
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={onConfirmar}
          disabled={pendente || aImportar === 0}
          className="botao-soberano text-sm"
        >
          {pendente ? "Importando..." : `Importar ${aImportar} transação(ões)`}
        </button>
        <button onClick={onDescartar} disabled={pendente} className="botao-fantasma text-sm">
          Descartar
        </button>
      </div>
    </div>
  );
}
