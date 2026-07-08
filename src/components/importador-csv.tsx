"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { formatarCentavos, formatarData } from "@/lib/money";
import { mensagemDeErro } from "@/lib/erros";
import { parseCsvExtrato, PRESETS, type PresetBanco, type LinhaImportacao } from "@/lib/csv";

type CategoriaOpcao = { id: string; nome: string; tipo: string };

type LinhaRevisao = {
  id: string;
  data: string;
  valor: number;
  descricao: string;
  categoria_sugerida: string | null;
  duplicada: boolean;
  ignorar: boolean;
};

type Etapa =
  | { fase: "upload" }
  | { fase: "revisao"; importacaoId: string; linhas: LinhaRevisao[]; descartadasParse: number };

export default function ImportadorCsv({ categorias }: { categorias: CategoriaOpcao[] }) {
  const router = useRouter();
  const [preset, setPreset] = useState<PresetBanco>("nubank");
  const [etapa, setEtapa] = useState<Etapa>({ fase: "upload" });
  const [pendente, setPendente] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function aoEscolherArquivo(e: React.ChangeEvent<HTMLInputElement>) {
    const arquivo = e.target.files?.[0];
    if (!arquivo) return;
    setErro(null);
    const texto = await arquivo.text();
    const { linhas, descartadas } = parseCsvExtrato(texto, preset);
    if (linhas.length === 0) {
      setErro(
        "Nenhuma linha reconhecida. Confira o banco selecionado ou use o preset Genérico."
      );
      e.target.value = "";
      return;
    }
    await enviarStaging(linhas, descartadas);
    e.target.value = "";
  }

  async function enviarStaging(linhas: LinhaImportacao[], descartadasParse: number) {
    setPendente(true);
    const { data, error } = await createClient().rpc("criar_importacao", {
      p_origem: "CSV",
      p_linhas: linhas,
    });
    setPendente(false);
    if (error) {
      setErro(mensagemDeErro(error));
      return;
    }
    const res = data as { importacao_id: string };
    // Relê o staging já com dedupe/categoria calculados pelo servidor.
    const { data: linhasData, error: erroLinhas } = await createClient()
      .from("importacao_linhas")
      .select("id, data, valor, descricao, categoria_sugerida, duplicada, ignorar")
      .eq("importacao_id", res.importacao_id)
      .order("data", { ascending: false });
    if (erroLinhas) {
      setErro(erroLinhas.message);
      return;
    }
    setEtapa({
      fase: "revisao",
      importacaoId: res.importacao_id,
      linhas: linhasData as LinhaRevisao[],
      descartadasParse,
    });
  }

  async function alternarIgnorar(linha: LinhaRevisao) {
    const novo = !linha.ignorar;
    // Otimista: reflete na hora, reverte no erro.
    atualizarLinhaLocal(linha.id, { ignorar: novo });
    const { error } = await createClient().rpc("atualizar_linha_importacao", {
      p_linha_id: linha.id,
      p_ignorar: novo,
    });
    if (error) {
      atualizarLinhaLocal(linha.id, { ignorar: linha.ignorar });
      setErro(mensagemDeErro(error));
    }
  }

  async function mudarCategoria(linha: LinhaRevisao, categoriaId: string) {
    atualizarLinhaLocal(linha.id, { categoria_sugerida: categoriaId || null });
    const { error } = await createClient().rpc("atualizar_linha_importacao", {
      p_linha_id: linha.id,
      p_categoria_id: categoriaId || null,
      p_limpar_categoria: categoriaId === "",
    });
    if (error) {
      atualizarLinhaLocal(linha.id, { categoria_sugerida: linha.categoria_sugerida });
      setErro(mensagemDeErro(error));
    }
  }

  function atualizarLinhaLocal(id: string, patch: Partial<LinhaRevisao>) {
    setEtapa((e) =>
      e.fase === "revisao"
        ? { ...e, linhas: e.linhas.map((l) => (l.id === id ? { ...l, ...patch } : l)) }
        : e
    );
  }

  async function confirmar() {
    if (etapa.fase !== "revisao") return;
    setErro(null);
    setPendente(true);
    const { data, error } = await createClient().rpc("confirmar_importacao", {
      p_importacao_id: etapa.importacaoId,
    });
    setPendente(false);
    if (error) {
      setErro(mensagemDeErro(error));
      return;
    }
    const res = data as { transacoes_criadas: number };
    setEtapa({ fase: "upload" });
    router.refresh();
    window.alert(`Importação concluída: ${res.transacoes_criadas} transação(ões) criada(s).`);
  }

  async function descartar() {
    if (etapa.fase !== "revisao") return;
    setPendente(true);
    await createClient().rpc("descartar_importacao", { p_importacao_id: etapa.importacaoId });
    setPendente(false);
    setEtapa({ fase: "upload" });
  }

  if (etapa.fase === "upload") {
    return (
      <div className="grid gap-4">
        <div className="vidro-soberano grid gap-3 p-5">
          <label className="text-sm">
            Banco / formato
            <select
              value={preset}
              onChange={(e) => setPreset(e.target.value as PresetBanco)}
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
            Arquivo CSV do extrato
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={aoEscolherArquivo}
              disabled={pendente}
              className="campo-soberano"
            />
          </label>
          <p className="text-xs" style={{ color: "var(--grafite)" }}>
            O arquivo é lido no seu navegador; só as linhas (data, valor,
            descrição) vão para o servidor, em uma área de revisão — nada entra
            direto no seu histórico.
          </p>
          {erro && (
            <p className="text-sm" style={{ color: "var(--telha)" }}>
              {erro}
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

  const aImportar = etapa.linhas.filter((l) => !l.ignorar).length;
  const duplicadas = etapa.linhas.filter((l) => l.duplicada).length;

  return (
    <div className="grid gap-4">
      <div
        className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm"
        style={{ color: "var(--grafite)" }}
      >
        <span>
          <b style={{ color: "var(--giz)" }}>{etapa.linhas.length}</b> linhas ·{" "}
          <b style={{ color: "var(--giz)" }}>{aImportar}</b> serão importadas
        </span>
        {duplicadas > 0 && (
          <span style={{ color: "var(--ouro)" }}>
            {duplicadas} possível(is) duplicada(s) — desmarcadas por padrão
          </span>
        )}
        {etapa.descartadasParse > 0 && (
          <span>{etapa.descartadasParse} linha(s) do arquivo não reconhecida(s)</span>
        )}
      </div>

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
            {etapa.linhas.map((l) => {
              const ehDespesa = l.valor < 0;
              return (
                <tr
                  key={l.id}
                  className="border-t"
                  style={{
                    borderColor: "var(--borda)",
                    opacity: l.ignorar ? 0.45 : 1,
                  }}
                >
                  <td className="px-2 py-2">
                    <input
                      type="checkbox"
                      checked={!l.ignorar}
                      onChange={() => alternarIgnorar(l)}
                      aria-label={`Importar ${l.descricao}`}
                    />
                  </td>
                  <td className="numero-soberano px-2 py-2 whitespace-nowrap">
                    {formatarData(l.data)}
                  </td>
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
                        onChange={(e) => mudarCategoria(l, e.target.value)}
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
            })}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={confirmar}
          disabled={pendente || aImportar === 0}
          className="botao-soberano text-sm"
        >
          {pendente ? "Importando..." : `Importar ${aImportar} transação(ões)`}
        </button>
        <button onClick={descartar} disabled={pendente} className="botao-fantasma text-sm">
          Descartar
        </button>
      </div>
    </div>
  );
}
