"use client";

// Estado e efeitos do fluxo de importação: ler o arquivo, mandar para o
// staging, editar as linhas em revisão, confirmar ou descartar. O componente
// que consome isto só renderiza — nenhuma chamada de RPC vive no JSX.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { mensagemDeErro } from "@/lib/erros";
import {
  validarTamanhoArquivoImportacao,
  validarTetoLinhasImportacao,
  type LinhaImportacao,
  type PresetBanco,
} from "@/lib/csv";
import { lerArquivoImportacao, sha256DoArquivo } from "@/lib/leitura-arquivo";
import {
  extensaoDoArquivo,
  origemPorExtensao,
  type LinhaRevisao,
  type OrigemImportacao,
} from "@/lib/importacao-preview";

export type Etapa =
  | { fase: "upload" }
  | {
      fase: "revisao";
      importacaoId: string;
      linhas: LinhaRevisao[];
      descartadasParse: number;
    };

/** Mensagem para "nenhuma linha reconhecida", que depende do formato lido. */
function motivoArquivoVazio(origem: OrigemImportacao): string {
  return origem === "CSV"
    ? "Nenhuma linha reconhecida. Confira o banco selecionado ou use o preset Genérico."
    : `Nenhum lançamento reconhecido no ${origem}. Exporte o extrato em CSV/OFX pelo banco se persistir.`;
}

export function useImportacao() {
  const router = useRouter();
  const [preset, setPreset] = useState<PresetBanco>("nubank");
  const [etapa, setEtapa] = useState<Etapa>({ fase: "upload" });
  const [pendente, setPendente] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  // Arquivo já importado não é erro: é um resultado esperado e informativo.
  const [aviso, setAviso] = useState<string | null>(null);

  function atualizarLinhaLocal(id: string, patch: Partial<LinhaRevisao>) {
    setEtapa((e) =>
      e.fase === "revisao"
        ? { ...e, linhas: e.linhas.map((l) => (l.id === id ? { ...l, ...patch } : l)) }
        : e,
    );
  }

  async function enviarStaging(
    linhas: LinhaImportacao[],
    descartadasParse: number,
    origem: OrigemImportacao,
    arquivoSha256: string | null,
  ) {
    setPendente(true);
    setAviso(null);
    let data;
    let error;
    try {
      ({ data, error } = await createClient().rpc("criar_importacao", {
        p_origem: origem,
        p_linhas: linhas,
        p_arquivo_sha256: arquivoSha256,
      }));
    } catch (err) {
      setPendente(false);
      setErro(mensagemDeErro(err));
      return;
    }
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
    if (res.arquivo_ja_importado && res.status_anterior !== "REVISAO") {
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

  async function processarArquivo(arquivo: File) {
    setErro(null);
    const erroTamanho = validarTamanhoArquivoImportacao(arquivo.size);
    if (erroTamanho) return setErro(erroTamanho);

    const origem = origemPorExtensao(extensaoDoArquivo(arquivo.name));
    setPendente(true);
    let resultado;
    try {
      resultado = await lerArquivoImportacao(arquivo, origem, preset);
    } catch (err) {
      setPendente(false);
      const detalhe = err instanceof Error ? err.message : String(err);
      return setErro(`Falha ao ler "${arquivo.name}": ${detalhe}`);
    }
    setPendente(false);

    if (resultado.linhas.length === 0) return setErro(motivoArquivoVazio(origem));
    const erroTeto = validarTetoLinhasImportacao(resultado.linhas.length);
    if (erroTeto) return setErro(erroTeto);

    await enviarStaging(
      resultado.linhas,
      resultado.descartadas,
      origem,
      await sha256DoArquivo(arquivo),
    );
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
    setErro(null);
    setPendente(true);
    let error;
    try {
      ({ error } = await createClient().rpc("descartar_importacao", {
        p_importacao_id: etapa.importacaoId,
      }));
    } catch (err) {
      setPendente(false);
      setErro(mensagemDeErro(err));
      return;
    }
    setPendente(false);
    if (error) {
      setErro(mensagemDeErro(error));
      return;
    }
    setEtapa({ fase: "upload" });
  }

  return {
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
  };
}
