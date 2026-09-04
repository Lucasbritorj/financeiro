import { test, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import FeedbackProvider from "@/components/feedback";

// O menu de comandos lança transação a partir de texto livre. O PARSER já é
// testado à exaustão em tests/unit/comando.test.ts; o que falta é o menu ligar
// o parser à RPC — mostrar a opção certa, disparar o payload certo, e não
// disparar duas vezes.

type Resposta = { data: unknown; error: unknown };
const rpc = vi.fn<(nome: string, params: unknown) => Promise<Resposta>>();
const push = vi.fn();
const refresh = vi.fn();
let respostaCartoes: Resposta = { data: [{ id: "cartao-1", nome: "Nubank" }], error: null };
const buscasDeCartao = vi.fn();

vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh }) }));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    rpc,
    from: () => ({
      select: () => ({
        order: () => {
          buscasDeCartao();
          return Promise.resolve(respostaCartoes);
        },
      }),
    }),
  }),
}));

// hojeSaoPaulo é lido uma vez por montagem, num useMemo — fixar a data mantém
// "ontem" e "dia 5" determinísticos.
vi.mock("@/lib/data", () => ({ hojeSaoPaulo: () => "2026-07-09" }));

const ComandoMenu = (await import("@/components/comando-menu")).default;

function montar() {
  render(
    <FeedbackProvider>
      <ComandoMenu />
    </FeedbackProvider>,
  );
}

/** Abre o menu e espera os cartões chegarem — o parser precisa deles. */
async function abrir(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: /Abrir menu de comandos/ }));
  const campo = screen.getByRole("combobox").querySelector("input")!;
  await waitFor(() => expect(campo).toBeInTheDocument());
  return campo as HTMLInputElement;
}

beforeEach(() => {
  rpc.mockReset();
  rpc.mockResolvedValue({ data: null, error: null });
  push.mockReset();
  refresh.mockReset();
  respostaCartoes = { data: [{ id: "cartao-1", nome: "Nubank" }], error: null };
  buscasDeCartao.mockReset();
});

afterEach(() => vi.restoreAllMocks());

// ------------------------------ Abertura ------------------------------

test("Ctrl+K abre e fecha o menu", async () => {
  montar();
  const dialogo = document.querySelector("dialog")!;
  expect(dialogo.open).toBe(false);

  fireEvent.keyDown(document, { key: "k", ctrlKey: true });
  await waitFor(() => expect(dialogo.open).toBe(true));

  fireEvent.keyDown(document, { key: "k", ctrlKey: true });
  await waitFor(() => expect(dialogo.open).toBe(false));
});

test("os cartões são buscados uma vez só, não a cada abertura", async () => {
  // O parser precisa deles para "no nubank"; refazer a query a cada Ctrl+K
  // seria uma ida ao servidor por atalho digitado.
  montar();
  const dialogo = document.querySelector("dialog")!;

  fireEvent.keyDown(document, { key: "k", ctrlKey: true });
  await waitFor(() => expect(buscasDeCartao).toHaveBeenCalledTimes(1));

  fireEvent.keyDown(document, { key: "k", ctrlKey: true });
  await waitFor(() => expect(dialogo.open).toBe(false));
  fireEvent.keyDown(document, { key: "k", ctrlKey: true });
  await waitFor(() => expect(dialogo.open).toBe(true));

  expect(buscasDeCartao).toHaveBeenCalledTimes(1);
});

// --------------------------- Lista de opções ---------------------------

test("frase com valor vira opção de registrar, com valor e descrição", async () => {
  const user = userEvent.setup();
  montar();
  const campo = await abrir(user);

  await user.type(campo, "45 ifood");

  const opcao = await screen.findByRole("option");
  expect(opcao.textContent).toMatch(/Registrar despesa/);
  expect(opcao.textContent).toMatch(/45,00/);
  expect(opcao.textContent).toMatch(/ifood/);
});

test("alias de rota vira opção de navegação", async () => {
  const user = userEvent.setup();
  montar();
  const campo = await abrir(user);

  await user.type(campo, "cofrinhos");

  expect(await screen.findByText(/Ir para Cofrinhos/)).toBeInTheDocument();
});

test("campo vazio sugere todas as rotas", async () => {
  const user = userEvent.setup();
  montar();
  await abrir(user);

  const opcoes = await screen.findAllByRole("option");
  expect(opcoes.length).toBe(8); // as 8 rotas de lib/comando.ts
});

test("frase ambígua mostra o motivo da recusa, sem opção executável", async () => {
  const user = userEvent.setup();
  montar();
  const campo = await abrir(user);

  await user.type(campo, "50 mercado pix débito");

  expect(await screen.findByText(/Mais de uma forma de pagamento/)).toBeInTheDocument();
  expect(screen.queryAllByRole("option")).toHaveLength(0);
});

// ------------------------------ Execução ------------------------------

test("Enter numa transação dispara a RPC com o payload do parser", async () => {
  const user = userEvent.setup();
  montar();
  const campo = await abrir(user);

  await user.type(campo, "45 ifood");
  await screen.findByRole("option");
  await user.keyboard("{Enter}");

  await waitFor(() =>
    expect(rpc).toHaveBeenCalledWith(
      "processar_transacao_completa",
      expect.objectContaining({
        p_descricao: "ifood",
        p_valor_total: 4500,
        p_tipo: "DESPESA",
        p_data_compra: "2026-07-09",
      }),
    ),
  );
});

test("registro bem-sucedido fecha o menu e refaz a rota", async () => {
  const user = userEvent.setup();
  montar();
  const campo = await abrir(user);
  const dialogo = document.querySelector("dialog")!;

  await user.type(campo, "45 ifood");
  await screen.findByRole("option");
  await user.keyboard("{Enter}");

  await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
  expect(dialogo.open).toBe(false);
});

test("erro na RPC mantém o menu aberto para corrigir a frase", async () => {
  // Fechar aqui faria o usuário redigitar tudo.
  const user = userEvent.setup();
  rpc.mockResolvedValue({ data: null, error: { message: "limite estourado" } });
  montar();
  const campo = await abrir(user);
  const dialogo = document.querySelector("dialog")!;

  await user.type(campo, "45 ifood");
  await screen.findByRole("option");
  await user.keyboard("{Enter}");

  await waitFor(() => expect(rpc).toHaveBeenCalled());
  expect(dialogo.open).toBe(true);
  expect(refresh).not.toHaveBeenCalled();
});

test("Enter numa rota navega e não toca no banco", async () => {
  const user = userEvent.setup();
  montar();
  const campo = await abrir(user);

  await user.type(campo, "cofrinhos");
  await screen.findByText(/Ir para Cofrinhos/);
  await user.keyboard("{Enter}");

  await waitFor(() => expect(push).toHaveBeenCalledWith("/cofrinhos"));
  expect(rpc).not.toHaveBeenCalled();
});

test("dois Enter seguidos não viram duas RPCs", async () => {
  // O guard é por ref, não por estado: dois eventos no mesmo tick não veriam
  // a atualização de `pendente` a tempo.
  const user = userEvent.setup();
  montar();
  const campo = await abrir(user);

  await user.type(campo, "45 ifood");
  await screen.findByRole("option");
  fireEvent.keyDown(campo, { key: "Enter" });
  fireEvent.keyDown(campo, { key: "Enter" });

  await waitFor(() => expect(rpc).toHaveBeenCalled());
  expect(rpc).toHaveBeenCalledTimes(1);
});

// ---------------------------- Teclado ----------------------------

test("setas movem a seleção e param nas pontas", async () => {
  // Sem variável para o campo: abrir() já o foca, e user.keyboard age no
  // elemento com foco.
  const user = userEvent.setup();
  montar();
  await abrir(user);
  await screen.findAllByRole("option");

  const selecionado = () =>
    screen.getAllByRole("option").findIndex((o) => o.getAttribute("aria-selected") === "true");

  expect(selecionado()).toBe(0);
  await user.keyboard("{ArrowUp}"); // já no topo: não sai do lugar
  expect(selecionado()).toBe(0);

  await user.keyboard("{ArrowDown}");
  expect(selecionado()).toBe(1);
  await user.keyboard("{ArrowUp}");
  expect(selecionado()).toBe(0);
});

test("digitar volta a seleção para a primeira opção", async () => {
  const user = userEvent.setup();
  montar();
  const campo = await abrir(user);
  await screen.findAllByRole("option");

  await user.keyboard("{ArrowDown}");
  await user.type(campo, "c");

  const opcoes = await screen.findAllByRole("option");
  expect(opcoes[0].getAttribute("aria-selected")).toBe("true");
});
