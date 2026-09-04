import { test, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { TransacaoLista, CategoriaOpcao, CartaoOpcao } from "@/components/lista-transacoes/tipos";

// A lista é onde o histórico é lido e mexido: recategorizar, criar regra,
// excluir em lote. A exclusão em massa usa allSettled de propósito — uma
// transação com parcela paga é recusada pelo banco (FW409) e não pode abortar
// as outras nem sumir da tela.

type Resposta = { data: unknown; error: unknown };
const rpc = vi.fn<(nome: string, params: unknown) => Promise<Resposta>>();
const refresh = vi.fn();
const notificar = vi.fn();
const confirmar = vi.fn(async () => true);
/** Resposta da página seguinte do keyset. */
let respostaPagina: Resposta = { data: [], error: null };
const filtrosAplicados = vi.fn();

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));

vi.mock("@/components/feedback", () => ({
  useToast: () => notificar,
  useConfirm: () => confirmar,
  default: ({ children }: { children: React.ReactNode }) => children,
}));

// O builder do PostgREST é encadeado; o teste só precisa que ele encadeie.
function consultaFalsa() {
  const encadeia: Record<string, unknown> = {};
  for (const metodo of ["select", "order", "or", "limit", "eq", "gte", "lte"]) {
    encadeia[metodo] = () => encadeia;
  }
  return encadeia;
}

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ rpc, from: () => consultaFalsa() }),
}));

vi.mock("@/lib/filtros-transacoes", () => ({
  aplicarFiltrosTransacoes: (_consulta: unknown, filtros: unknown) => {
    filtrosAplicados(filtros);
    return Promise.resolve(respostaPagina);
  },
}));

const ListaTransacoes = (await import("@/components/lista-transacoes")).default;

const CATEGORIAS: CategoriaOpcao[] = [
  { id: "cat-mercado", nome: "Mercado", tipo: "DESPESA" },
  { id: "cat-salario", nome: "Salário", tipo: "RECEITA" },
];
const CARTOES: CartaoOpcao[] = [{ id: "cartao-1", nome: "Nubank" }];

function transacao(over: Partial<TransacaoLista> = {}): TransacaoLista {
  return {
    id: "tx-1",
    descricao: "MERCADO",
    valor_total: 5000,
    tipo: "DESPESA",
    forma_pagamento: "PIX",
    data_compra: "2026-07-09",
    data_vencimento: null,
    num_parcelas: 1,
    created_at: "2026-07-09T10:00:00Z",
    categoria_id: null,
    source: "MANUAL",
    natureza: null,
    ...over,
  };
}

function montar(
  inicial: TransacaoLista[] = [transacao()],
  extra: { temMais?: boolean; filtros?: Record<string, unknown> } = {},
) {
  render(
    <ListaTransacoes
      inicial={inicial}
      categorias={CATEGORIAS}
      cartoes={CARTOES}
      temMais={extra.temMais ?? false}
      filtros={extra.filtros ?? {}}
    />,
  );
}

beforeEach(() => {
  rpc.mockReset();
  rpc.mockResolvedValue({ data: null, error: null });
  refresh.mockReset();
  notificar.mockReset();
  confirmar.mockReset();
  confirmar.mockResolvedValue(true);
  filtrosAplicados.mockReset();
  respostaPagina = { data: [], error: null };
});

afterEach(() => vi.restoreAllMocks());

// ------------------------------ Renderização ------------------------------

test("lista vazia convida a lançar ou importar, sem controles", () => {
  montar([]);
  expect(screen.getByText(/Nenhuma transação registrada ainda/)).toBeInTheDocument();
  expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
});

test("despesa aparece com sinal negativo e receita com positivo", () => {
  montar([
    transacao({ id: "a", descricao: "GASTO", tipo: "DESPESA" }),
    transacao({ id: "b", descricao: "ENTRADA", tipo: "RECEITA" }),
  ]);
  expect(screen.getByLabelText(/saída de/)).toHaveTextContent(/^-/);
  expect(screen.getByLabelText(/entrada de/)).toHaveTextContent(/^\+/);
});

test("boleto mostra o vencimento; o resto mostra data, forma e parcelas", () => {
  montar([
    transacao({
      id: "a",
      forma_pagamento: "BOLETO",
      data_vencimento: "2026-08-10",
      descricao: "LUZ",
    }),
    transacao({ id: "b", forma_pagamento: "CREDITO", num_parcelas: 3, descricao: "TV" }),
  ]);
  expect(screen.getByText(/Boleto · vence/)).toBeInTheDocument();
  expect(screen.getByText(/CREDITO · 3x/)).toBeInTheDocument();
});

test("compra à vista não anuncia parcelamento", () => {
  montar([transacao({ forma_pagamento: "CREDITO", num_parcelas: 1 })]);
  expect(screen.queryByText(/1x/)).not.toBeInTheDocument();
});

test("liquidação de fatura ganha selo, porque não soma nas despesas", () => {
  montar([transacao({ natureza: "LIQUIDACAO_FATURA" })]);
  expect(screen.getByText("Liquidação de fatura")).toBeInTheDocument();
});

test("origem importada vira selo; lançamento manual não", () => {
  // Marcar "MANUAL" em tudo que foi digitado seria ruído.
  montar([
    transacao({ id: "a", source: "OFX", descricao: "IMPORTADA" }),
    transacao({ id: "b", source: "MANUAL", descricao: "DIGITADA" }),
  ]);
  expect(screen.getByText("OFX")).toBeInTheDocument();
  expect(screen.queryByText("MANUAL")).not.toBeInTheDocument();
});

test("o seletor de categoria segue o tipo da linha", () => {
  montar([transacao({ tipo: "DESPESA", descricao: "GASTO" })]);
  const select = screen.getByLabelText("Categoria de GASTO");
  const opcoes = within(select).getAllByRole("option").map((o) => o.textContent);
  expect(opcoes).toEqual(["Sem categoria", "Mercado"]);
});

test("'criar regra' só aparece em linha que já tem categoria", () => {
  montar([
    transacao({ id: "a", categoria_id: "cat-mercado" }),
    transacao({ id: "b", categoria_id: null }),
  ]);
  expect(screen.getAllByRole("button", { name: /criar regra/ })).toHaveLength(1);
});

// ------------------------------ Recategorizar ------------------------------

test("trocar a categoria persiste e reflete na linha", async () => {
  const user = userEvent.setup();
  montar([transacao({ descricao: "GASTO" })]);

  await user.selectOptions(screen.getByLabelText("Categoria de GASTO"), "cat-mercado");

  await waitFor(() =>
    expect(rpc).toHaveBeenCalledWith("definir_categoria_transacao", {
      p_transacao_id: "tx-1",
      p_categoria_id: "cat-mercado",
      p_criar_regra: false,
      p_padrao: null,
    }),
  );
  expect(refresh).not.toHaveBeenCalled(); // troca simples não recarrega a rota
});

test("criar regra manda o padrão e recarrega a rota", async () => {
  const user = userEvent.setup();
  montar([transacao({ categoria_id: "cat-mercado", descricao: "  SUPERMERCADO XYZ  " })]);

  await user.click(screen.getByRole("button", { name: /criar regra/ }));

  await waitFor(() =>
    expect(rpc).toHaveBeenCalledWith(
      "definir_categoria_transacao",
      expect.objectContaining({ p_criar_regra: true, p_padrao: "SUPERMERCADO XYZ" }),
    ),
  );
  await waitFor(() => expect(refresh).toHaveBeenCalled());
});

test("erro ao recategorizar avisa e não muda a linha", async () => {
  const user = userEvent.setup();
  rpc.mockResolvedValue({ data: null, error: { message: "categoria inexistente" } });
  montar([transacao({ descricao: "GASTO" })]);

  const select = screen.getByLabelText("Categoria de GASTO") as HTMLSelectElement;
  await user.selectOptions(select, "cat-mercado");

  await waitFor(() => expect(notificar).toHaveBeenCalledWith("categoria inexistente", "erro"));
});

// ------------------------------ Seleção e lote ------------------------------

test("selecionar todas marca tudo e limpar desmarca", async () => {
  const user = userEvent.setup();
  montar([transacao({ id: "a", descricao: "UMA" }), transacao({ id: "b", descricao: "OUTRA" })]);

  await user.click(screen.getByLabelText(/Selecionar todas/));
  expect(screen.getByText("2 selecionada(s)")).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "limpar" }));
  expect(screen.queryByText(/selecionada\(s\)/)).not.toBeInTheDocument();
});

test("recusar a confirmação não exclui nada", async () => {
  const user = userEvent.setup();
  confirmar.mockResolvedValue(false);
  montar([transacao({ descricao: "UMA" })]);

  await user.click(screen.getByLabelText(/Selecionar todas/));
  await user.click(screen.getByRole("button", { name: /Excluir selecionadas/ }));

  expect(rpc).not.toHaveBeenCalled();
  expect(screen.getByText("UMA")).toBeInTheDocument();
});

test("exclusão em lote remove as que deram certo e mantém as que falharam", async () => {
  // O ponto do allSettled: um FW409 numa transação com parcela paga não pode
  // abortar as outras, nem sumir da tela como se tivesse ido embora.
  const user = userEvent.setup();
  rpc.mockImplementation(async (_nome, params) => {
    const { p_transacao_id } = params as { p_transacao_id: string };
    return p_transacao_id === "b"
      ? { data: null, error: { message: "parcela paga" } }
      : { data: null, error: null };
  });
  montar([
    transacao({ id: "a", descricao: "VAI SUMIR" }),
    transacao({ id: "b", descricao: "VAI FICAR" }),
  ]);

  await user.click(screen.getByLabelText(/Selecionar todas/));
  await user.click(screen.getByRole("button", { name: /Excluir selecionadas/ }));

  await waitFor(() => expect(screen.queryByText("VAI SUMIR")).not.toBeInTheDocument());
  expect(screen.getByText("VAI FICAR")).toBeInTheDocument();
  expect(notificar).toHaveBeenCalledWith(
    expect.stringMatching(/1 excluída\(s\); 1 não puderam/),
    "erro",
  );
});

test("lote inteiro bem-sucedido avisa como sucesso", async () => {
  const user = userEvent.setup();
  montar([transacao({ id: "a", descricao: "UMA" }), transacao({ id: "b", descricao: "OUTRA" })]);

  await user.click(screen.getByLabelText(/Selecionar todas/));
  await user.click(screen.getByRole("button", { name: /Excluir selecionadas/ }));

  await waitFor(() =>
    expect(notificar).toHaveBeenCalledWith("2 transação(ões) excluída(s).", "sucesso"),
  );
  expect(refresh).toHaveBeenCalled();
});

// ------------------------------ Paginação ------------------------------

test("sem mais páginas, não há botão de carregar", () => {
  montar([transacao()], { temMais: false });
  expect(screen.queryByRole("button", { name: /Carregar mais/ })).not.toBeInTheDocument();
});

test("carregar mais anexa a página e repassa os filtros da primeira", async () => {
  const user = userEvent.setup();
  respostaPagina = { data: [transacao({ id: "z", descricao: "DA PAGINA 2" })], error: null };
  montar([transacao({ id: "a", descricao: "DA PAGINA 1" })], {
    temMais: true,
    filtros: { tipo: "DESPESA" },
  });

  await user.click(screen.getByRole("button", { name: /Carregar mais/ }));

  expect(await screen.findByText("DA PAGINA 2")).toBeInTheDocument();
  expect(screen.getByText("DA PAGINA 1")).toBeInTheDocument();
  // O keyset continua com os mesmos filtros da primeira página.
  expect(filtrosAplicados).toHaveBeenCalledWith({ tipo: "DESPESA" });
});

test("página menor que o limite encerra a paginação", async () => {
  const user = userEvent.setup();
  respostaPagina = { data: [transacao({ id: "z", descricao: "ULTIMA" })], error: null };
  montar([transacao({ id: "a" })], { temMais: true });

  await user.click(screen.getByRole("button", { name: /Carregar mais/ }));

  await screen.findByText("ULTIMA");
  expect(screen.queryByRole("button", { name: /Carregar mais/ })).not.toBeInTheDocument();
});

test("erro ao paginar avisa e mantém o que já estava na tela", async () => {
  const user = userEvent.setup();
  respostaPagina = { data: null, error: { message: "timeout" } };
  montar([transacao({ descricao: "JA CARREGADA" })], { temMais: true });

  await user.click(screen.getByRole("button", { name: /Carregar mais/ }));

  await waitFor(() => expect(notificar).toHaveBeenCalledWith("timeout", "erro"));
  expect(screen.getByText("JA CARREGADA")).toBeInTheDocument();
});

// ------------------------------ Edição ------------------------------

test("Editar troca a linha pelo formulário", async () => {
  const user = userEvent.setup();
  montar([transacao({ descricao: "MERCADO" })]);

  await user.click(screen.getByRole("button", { name: "Editar" }));

  expect(screen.getByLabelText("Descrição")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Cancelar" })).toBeInTheDocument();
});
