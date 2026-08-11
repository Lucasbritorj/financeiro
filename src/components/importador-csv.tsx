"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { formatarCentavos, formatarData } from "@/lib/money";
import { mensagemDeErro } from "@/lib/erros";
import {
  parseCsvExtrato,
  parseMatrizExtrato,
  PRESETS,
  type PresetBanco,
  type LinhaImportacao,
  type ResultadoParse,
  validarTamanhoArquivoImportacao,
  validarTetoLinhasImportacao,
} from "@/lib/csv";
import { parseOfxExtrato } from "@/lib/ofx";
import { parsePdfExtrato } from "@/lib/pdf-extrato";

type CategoriaOpcao = { id: string; nome: string; tipo: string };

type LinhaRevisao = {
  id: string;
  data: string;
  valor: number;
  descricao: string;
  categoria_sugerida: string | null;
  duplicada: boolean;
  ignorar: boolean;
  /** 0020: NOVO grava; DUPLICADO nunca grava; AMBIGUO exige opt-in. */
  classificacao: "NOVO" | "DUPLICADO" | "AMBIGUO";
};

type Etapa =
  | { fase: "upload" }
  | { fase: "revisao"; importacaoId: string; linhas: LinhaRevisao[]; descartadasParse: number };

type OrigemImportacao = "CSV" | "OFX" | "OFC" | "XLSX" | "PDF";

// Bancos BR exportam CSV/OFX em Windows-1252 (superset do ISO-8859-1) tão
// often quanto em UTF-8. Tenta UTF-8 estrito (fatal): se os bytes não forem
// UTF-8 válido, decai para windows-1252 — que decodifica acentos (ê, ç, ã…) e
// os caracteres 0x80-0x9F (–, …, aspas curvas) sem virar "�".
async function lerTexto(arquivo: File): Promise<string> {
  const bruto = await arquivo.arrayBuffer();
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bruto);
  } catch {
    return new TextDecoder("windows-1252").decode(bruto);
  }
}

/**
 * sha256 do arquivo CRU (bytes, não do texto decodificado): reenviar o mesmo
 * arquivo é identificado antes de qualquer parse. Hash sobre o texto decaria
 * junto com a heurística de encoding — dois decodes diferentes do mesmo byte
 * dariam hashes diferentes.
 *
 * `crypto.subtle` exige secure context (https ou localhost). Fora dele
 * devolvemos null e o servidor simplesmente não faz o short-circuit — a dedup
 * por linha da 0020/0021 continua valendo.
 */
async function sha256DoArquivo(arquivo: File): Promise<string | null> {
  if (!globalThis.crypto?.subtle) return null;
  try {
    const buf = await crypto.subtle.digest("SHA-256", await arquivo.arrayBuffer());
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
  } catch {
    return null;
  }
}

// XLSX -> matriz de strings (1ª aba). exceljs entra por import dinâmico:
// só quem importa planilha paga o peso do bundle.
async function matrizDoXlsx(arquivo: File): Promise<string[][]> {
  const { Workbook } = await import("exceljs");
  const wb = new Workbook();
  await wb.xlsx.load(await arquivo.arrayBuffer());
  const aba = wb.worksheets[0];
  if (!aba) return [];
  const matriz: string[][] = [];
  aba.eachRow((linha) => {
    const campos: string[] = [];
    linha.eachCell({ includeEmpty: true }, (celula) => {
      const v = celula.value;
      if (v == null) campos.push("");
      else if (v instanceof Date) {
        const dd = String(v.getUTCDate()).padStart(2, "0");
        const mm = String(v.getUTCMonth() + 1).padStart(2, "0");
        campos.push(`${dd}/${mm}/${v.getUTCFullYear()}`);
      } else if (typeof v === "object" && "richText" in v) {
        campos.push(v.richText.map((t) => t.text).join(""));
      } else if (typeof v === "object" && "result" in v) {
        campos.push(v.result == null ? "" : String(v.result));
      } else campos.push(String(v));
    });
    matriz.push(campos);
  });
  return matriz;
}

// PDF -> linhas de texto (pdfjs-dist, import dinâmico). Agrupa os pedaços
// pela coordenada Y para reconstruir as linhas visuais do extrato.
async function linhasDoPdf(arquivo: File): Promise<string[]> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.min.mjs",
    import.meta.url,
  ).toString();
  const doc = await pdfjs.getDocument({ data: await arquivo.arrayBuffer() }).promise;
  const linhas: string[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const pagina = await doc.getPage(p);
    const conteudo = await pagina.getTextContent();
    const porY = new Map<number, { x: number; texto: string }[]>();
    for (const item of conteudo.items) {
      if (!("str" in item) || item.str.trim() === "") continue;
      const y = Math.round(item.transform[5]);
      const grupo = porY.get(y) ?? [];
      grupo.push({ x: item.transform[4], texto: item.str });
      porY.set(y, grupo);
    }
    const ys = [...porY.keys()].sort((a, b) => b - a); // topo -> base
    for (const y of ys) {
      const pedacos = porY.get(y)!.sort((a, b) => a.x - b.x);
      linhas.push(pedacos.map((s) => s.texto).join(" "));
    }
  }
  return linhas;
}

export default function ImportadorCsv({ categorias }: { categorias: CategoriaOpcao[] }) {
  const router = useRouter();
  const [preset, setPreset] = useState<PresetBanco>("nubank");
  const [etapa, setEtapa] = useState<Etapa>({ fase: "upload" });
  const [pendente, setPendente] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  // Arquivo já importado não é erro: é um resultado esperado e informativo.
  const [aviso, setAviso] = useState<string | null>(null);

  async function aoEscolherArquivo(e: React.ChangeEvent<HTMLInputElement>) {
    const arquivo = e.target.files?.[0];
    if (!arquivo) return;
    setErro(null);
    const erroTamanho = validarTamanhoArquivoImportacao(arquivo.size);
    if (erroTamanho) {
      setErro(erroTamanho);
      e.target.value = "";
      return;
    }
    const ext = arquivo.name.split(".").pop()?.toLowerCase() ?? "";
    let resultado: ResultadoParse;
    let origem: OrigemImportacao;
    setPendente(true);
    try {
      if (ext === "ofx" || ext === "ofc") {
        resultado = parseOfxExtrato(await lerTexto(arquivo));
        origem = ext.toUpperCase() as OrigemImportacao;
      } else if (ext === "xlsx") {
        resultado = parseMatrizExtrato(await matrizDoXlsx(arquivo));
        origem = "XLSX";
      } else if (ext === "pdf") {
        resultado = parsePdfExtrato(await linhasDoPdf(arquivo), new Date().getFullYear());
        origem = "PDF";
      } else {
        resultado = parseCsvExtrato(await lerTexto(arquivo), preset);
        origem = "CSV";
      }
    } catch (err) {
      setPendente(false);
      setErro(
        `Falha ao ler "${arquivo.name}": ${err instanceof Error ? err.message : String(err)}`,
      );
      e.target.value = "";
      return;
    }
    setPendente(false);
    if (resultado.linhas.length === 0) {
      setErro(
        origem === "CSV"
          ? "Nenhuma linha reconhecida. Confira o banco selecionado ou use o preset Genérico."
          : `Nenhum lançamento reconhecido no ${origem}. Exporte o extrato em CSV/OFX pelo banco se persistir.`,
      );
      e.target.value = "";
      return;
    }
    const erroTeto = validarTetoLinhasImportacao(resultado.linhas.length);
    if (erroTeto) {
      setErro(erroTeto);
      e.target.value = "";
      return;
    }
    await enviarStaging(
      resultado.linhas,
      resultado.descartadas,
      origem,
      await sha256DoArquivo(arquivo),
    );
    e.target.value = "";
  }

  async function enviarStaging(
    linhas: LinhaImportacao[],
    descartadasParse: number,
    origem: OrigemImportacao,
    arquivoSha256: string | null,
  ) {
    setPendente(true);
    setAviso(null);
    const { data, error } = await createClient().rpc("criar_importacao", {
      p_origem: origem,
      p_linhas: linhas,
      p_arquivo_sha256: arquivoSha256,
    });
    setPendente(false);
    if (error) {
      setErro(mensagemDeErro(error));
      return;
    }
    const res = data as {
      importacao_id: string;
      arquivo_ja_importado?: boolean;
      status_anterior?: string;
    };
    // Short-circuit da 0021: arquivo idêntico já enviado. O servidor não criou
    // staging novo, então não há o que revisar — fica na tela de upload.
    if (res.arquivo_ja_importado) {
      setAviso(
        res.status_anterior === "CONFIRMADA"
          ? "Este arquivo já foi importado e confirmado. Nada foi duplicado."
          : "Este arquivo já está aguardando revisão em outra importação. Termine ou descarte aquela antes de subir de novo.",
      );
      return;
    }
    // Relê o staging já com dedupe/categoria calculados pelo servidor.
    const { data: linhasData, error: erroLinhas } = await createClient()
      .from("importacao_linhas")
      .select("id, data, valor, descricao, categoria_sugerida, duplicada, ignorar, classificacao")
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
            Banco / formato (usado só para CSV)
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

  // DUPLICADO nunca grava, mesmo desmarcado — a regra vive em
  // confirmar_importacao (0020). A contagem aqui espelha o servidor em vez de
  // prometer algo que o banco vai recusar.
  const aImportar = etapa.linhas.filter(
    (l) => !l.ignorar && l.classificacao !== "DUPLICADO",
  ).length;
  const novos = etapa.linhas.filter((l) => l.classificacao === "NOVO").length;
  const duplicadas = etapa.linhas.filter((l) => l.classificacao === "DUPLICADO").length;
  const ambiguos = etapa.linhas.filter((l) => l.classificacao === "AMBIGUO").length;

  return (
    <div className="grid gap-4">
      <div
        className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm"
        style={{ color: "var(--grafite)" }}
      >
        <span>
          <b style={{ color: "var(--giz)" }}>{etapa.linhas.length}</b> linhas ·{" "}
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
