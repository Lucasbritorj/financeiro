import { test, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { LIMITE_BYTES_IMPORTACAO } from "@/lib/constantes";
import type { LinhaRevisao } from "@/lib/importacao-preview";

// O hook é o fluxo real da importação: staging, short-circuit por hash do
// arquivo, e o rollback otimista das edições em revisão. As duas telas já têm
// teste de render; o que passa ENTRE elas não tinha nada.
//
// O client do Supabase é mockado no módulo, não na rede. O que se quer travar
// aqui é a orquestração — sequência de chamadas, tratamento de erro, reversão
// de estado — e não se o supabase-js monta a URL do PostgREST corretamente,
// que é responsabilidade da lib. MSW faria o segundo ao custo de replicar o
// wire format do PostgREST no teste.

type Resposta = { data: unknown; error: unknown };

const rpc = vi.fn<(nome: string, params: unknown) => Promise<Resposta>>();
/** Resposta do SELECT que relê o staging depois de criar a importação. */
let respostaDoSelect: Resposta = { data: [], error: null };
const refresh = vi.fn();

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    rpc,
    from: () => ({
      select: () => ({
        eq: () => ({
          order: () => Promise.resolve(respostaDoSelect),
        }),
      }),
    }),
  }),
}));

// Importado depois dos mocks: o hook resolve createClient no topo do módulo.
const { useImportacao } = await import("@/components/importador-csv/use-importacao");

const CSV = ["Data,Valor,Identificador,Descrição", "2026-07-01,-50.00,abc,MERCADO"].join("\n");

function arquivo(nome = "extrato.csv", conteudo = CSV, bytes?: number): File {
  const f = new File([conteudo], nome, { type: "text/csv" });
  // Forjar o tamanho evita alocar 10 MB só para exercitar o guard.
  if (bytes != null) Object.defineProperty(f, "size", { value: bytes });
  return f;
}

const LINHA_STAGING: LinhaRevisao = {
  id: "linha-1",
  data: "2026-07-01",
  valor: -5000,
  descricao: "MERCADO",
  categoria_sugerida: null,
  duplicada: false,
  ignorar: false,
  classificacao: "NOVO",
};

beforeEach(() => {
  rpc.mockReset();
  refresh.mockReset();
  respostaDoSelect = { data: [LINHA_STAGING], error: null };
  vi.spyOn(window, "alert").mockImplementation(() => {});
});

afterEach(() => vi.restoreAllMocks());

/** Leva o hook até a fase de revisão com uma linha em staging. */
async function emRevisao() {
  rpc.mockResolvedValueOnce({ data: { importacao_id: "imp-1" }, error: null });
  const { result } = renderHook(() => useImportacao());
  await act(async () => {
    await result.current.processarArquivo(arquivo());
  });
  await waitFor(() => expect(result.current.etapa.fase).toBe("revisao"));
  rpc.mockReset();
  return result;
}

// ------------------------------ Upload ------------------------------

test("começa na fase de upload, sem erro nem aviso", () => {
  const { result } = renderHook(() => useImportacao());
  expect(result.current.etapa.fase).toBe("upload");
  expect(result.current.erro).toBeNull();
  expect(result.current.aviso).toBeNull();
  expect(result.current.pendente).toBe(false);
});

test("arquivo acima do teto de bytes nem chega a ser lido", async () => {
  const { result } = renderHook(() => useImportacao());
  await act(async () => {
    await result.current.processarArquivo(arquivo("g.csv", CSV, LIMITE_BYTES_IMPORTACAO + 1));
  });
  expect(result.current.erro).toBeTruthy();
  expect(rpc).not.toHaveBeenCalled(); // não gasta viagem ao servidor
});

test("CSV sem linha reconhecível explica que o preset pode estar errado", async () => {
  const { result } = renderHook(() => useImportacao());
  await act(async () => {
    await result.current.processarArquivo(arquivo("vazio.csv", "cabecalho invalido\n"));
  });
  expect(result.current.erro).toMatch(/banco selecionado ou use o preset Genérico/);
  expect(rpc).not.toHaveBeenCalled();
});

test("formato não-CSV sem lançamento dá mensagem própria, citando a origem", async () => {
  const { result } = renderHook(() => useImportacao());
  await act(async () => {
    await result.current.processarArquivo(arquivo("extrato.ofx", "lixo"));
  });
  expect(result.current.erro).toMatch(/Nenhum lançamento reconhecido no OFX/);
});

test("sucesso manda origem e linhas para criar_importacao e vai para revisão", async () => {
  rpc.mockResolvedValueOnce({ data: { importacao_id: "imp-9" }, error: null });
  const { result } = renderHook(() => useImportacao());

  await act(async () => {
    await result.current.processarArquivo(arquivo());
  });

  expect(rpc).toHaveBeenCalledWith(
    "criar_importacao",
    expect.objectContaining({
      p_origem: "CSV",
      p_linhas: [expect.objectContaining({ valor: -5000, descricao: "MERCADO" })],
    }),
  );
  await waitFor(() => {
    expect(result.current.etapa).toMatchObject({
      fase: "revisao",
      importacaoId: "imp-9",
      linhas: [LINHA_STAGING],
    });
  });
  expect(result.current.pendente).toBe(false);
});

test("erro na RPC de staging não avança de fase", async () => {
  rpc.mockResolvedValueOnce({ data: null, error: { message: "boom" } });
  const { result } = renderHook(() => useImportacao());
  await act(async () => {
    await result.current.processarArquivo(arquivo());
  });
  expect(result.current.etapa.fase).toBe("upload");
  expect(result.current.erro).toBeTruthy();
  expect(result.current.pendente).toBe(false);
});

test("falha ao reler o staging reporta e fica no upload", async () => {
  rpc.mockResolvedValueOnce({ data: { importacao_id: "imp-1" }, error: null });
  respostaDoSelect = { data: null, error: { message: "select falhou" } };
  const { result } = renderHook(() => useImportacao());
  await act(async () => {
    await result.current.processarArquivo(arquivo());
  });
  expect(result.current.erro).toBe("select falhou");
  expect(result.current.etapa.fase).toBe("upload");
});

// --------------------- Short-circuit por hash (0021) ---------------------

test("arquivo já confirmado vira aviso, não erro, e não abre revisão", async () => {
  // É resultado esperado e informativo: nada foi duplicado.
  rpc.mockResolvedValueOnce({
    data: { importacao_id: "imp-1", arquivo_ja_importado: true, status_anterior: "CONFIRMADA" },
    error: null,
  });
  const { result } = renderHook(() => useImportacao());
  await act(async () => {
    await result.current.processarArquivo(arquivo());
  });
  expect(result.current.aviso).toMatch(/já foi importado e confirmado/);
  expect(result.current.erro).toBeNull();
  expect(result.current.etapa.fase).toBe("upload");
});

test("arquivo aguardando revisão em outra importação pede para terminar aquela", async () => {
  rpc.mockResolvedValueOnce({
    data: { importacao_id: "imp-1", arquivo_ja_importado: true, status_anterior: "PENDENTE" },
    error: null,
  });
  const { result } = renderHook(() => useImportacao());
  await act(async () => {
    await result.current.processarArquivo(arquivo());
  });
  expect(result.current.aviso).toMatch(/Termine ou descarte aquela/);
  expect(result.current.etapa.fase).toBe("upload");
});

// ----------------------- Edição otimista em revisão -----------------------

test("alternar ignorar aplica na hora e persiste", async () => {
  const result = await emRevisao();
  rpc.mockResolvedValueOnce({ data: null, error: null });

  await act(async () => {
    await result.current.alternarIgnorar(LINHA_STAGING);
  });

  expect(rpc).toHaveBeenCalledWith("atualizar_linha_importacao", {
    p_linha_id: "linha-1",
    p_ignorar: true,
  });
  const etapa = result.current.etapa;
  expect(etapa.fase === "revisao" && etapa.linhas[0].ignorar).toBe(true);
  expect(result.current.erro).toBeNull();
});

test("alternar ignorar reverte o estado quando a RPC falha", async () => {
  // O ponto do otimismo: a UI não pode ficar mentindo sobre o banco.
  const result = await emRevisao();
  rpc.mockResolvedValueOnce({ data: null, error: { message: "sem permissão" } });

  await act(async () => {
    await result.current.alternarIgnorar(LINHA_STAGING);
  });

  const etapa = result.current.etapa;
  expect(etapa.fase === "revisao" && etapa.linhas[0].ignorar).toBe(false); // voltou
  expect(result.current.erro).toBeTruthy();
});

test("mudar categoria manda o id e reflete na linha", async () => {
  const result = await emRevisao();
  rpc.mockResolvedValueOnce({ data: null, error: null });

  await act(async () => {
    await result.current.mudarCategoria(LINHA_STAGING, "cat-mercado");
  });

  expect(rpc).toHaveBeenCalledWith("atualizar_linha_importacao", {
    p_linha_id: "linha-1",
    p_categoria_id: "cat-mercado",
    p_limpar_categoria: false,
  });
  const etapa = result.current.etapa;
  expect(etapa.fase === "revisao" && etapa.linhas[0].categoria_sugerida).toBe("cat-mercado");
});

test("categoria vazia aciona p_limpar_categoria e grava null", async () => {
  // "" e null são coisas diferentes na RPC: só a string vazia limpa.
  const result = await emRevisao();
  rpc.mockResolvedValueOnce({ data: null, error: null });

  await act(async () => {
    await result.current.mudarCategoria({ ...LINHA_STAGING, categoria_sugerida: "x" }, "");
  });

  expect(rpc).toHaveBeenCalledWith("atualizar_linha_importacao", {
    p_linha_id: "linha-1",
    p_categoria_id: null,
    p_limpar_categoria: true,
  });
  const etapa = result.current.etapa;
  expect(etapa.fase === "revisao" && etapa.linhas[0].categoria_sugerida).toBeNull();
});

test("mudar categoria reverte para a anterior quando a RPC falha", async () => {
  const result = await emRevisao();
  rpc.mockResolvedValueOnce({ data: null, error: { message: "falhou" } });

  await act(async () => {
    await result.current.mudarCategoria(LINHA_STAGING, "cat-nova");
  });

  const etapa = result.current.etapa;
  expect(etapa.fase === "revisao" && etapa.linhas[0].categoria_sugerida).toBeNull(); // voltou
  expect(result.current.erro).toBeTruthy();
});

// ------------------------- Confirmar e descartar -------------------------

test("confirmar grava, volta ao upload e refaz a rota", async () => {
  const result = await emRevisao();
  rpc.mockResolvedValueOnce({ data: { transacoes_criadas: 3 }, error: null });

  await act(async () => {
    await result.current.confirmar();
  });

  expect(rpc).toHaveBeenCalledWith("confirmar_importacao", { p_importacao_id: "imp-1" });
  expect(result.current.etapa.fase).toBe("upload");
  expect(refresh).toHaveBeenCalledTimes(1);
});

test("erro ao confirmar mantém a revisão aberta", async () => {
  // Perder a tela de revisão aqui obrigaria o usuário a subir o arquivo de novo.
  const result = await emRevisao();
  rpc.mockResolvedValueOnce({ data: null, error: { message: "conflito" } });

  await act(async () => {
    await result.current.confirmar();
  });

  expect(result.current.etapa.fase).toBe("revisao");
  expect(result.current.erro).toBeTruthy();
  expect(refresh).not.toHaveBeenCalled();
});

test("descartar volta ao upload", async () => {
  const result = await emRevisao();
  rpc.mockResolvedValueOnce({ data: null, error: null });

  await act(async () => {
    await result.current.descartar();
  });

  expect(rpc).toHaveBeenCalledWith("descartar_importacao", { p_importacao_id: "imp-1" });
  expect(result.current.etapa.fase).toBe("upload");
});

test("confirmar e descartar fora da revisão não chamam nada", async () => {
  const { result } = renderHook(() => useImportacao());
  await act(async () => {
    await result.current.confirmar();
    await result.current.descartar();
  });
  expect(rpc).not.toHaveBeenCalled();
});
