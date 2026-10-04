import { test, expect, vi, beforeEach } from "vitest";
import { render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import FeedbackProvider from "@/components/feedback";

type Resposta = { data: unknown; error: unknown };
const rpc = vi.fn<(nome: string, params: unknown) => Promise<Resposta>>();
const order = vi.fn<() => Promise<Resposta>>();
const select = vi.fn(() => ({ order }));
const from = vi.fn(() => ({ select }));
const refresh = vi.fn();
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ rpc, from }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
const { default: Recorrencias } = await import("@/components/recorrencias");

const linha = {
  id: "rec-1", descricao: "Aluguel", valor: 123456, tipo: "DESPESA",
  forma_pagamento: "PIX", categoria_id: null, dia_do_mes: 5,
  proxima_data: "2026-11-05", ativa: true,
};

function montar() {
  render(<FeedbackProvider><Recorrencias categorias={[
    { id: "cat-1", nome: "Moradia", tipo: "DESPESA" },
  ]} /></FeedbackProvider>);
}

async function preencher(user: ReturnType<typeof userEvent.setup>, valor = "1.234,56") {
  await user.click(screen.getByRole("button", { name: "Nova recorrência" }));
  await user.type(screen.getByLabelText("Descrição"), "  Aluguel  ");
  await user.type(screen.getByLabelText("Valor (R$)"), valor);
}

beforeEach(() => {
  rpc.mockReset();
  rpc.mockResolvedValue({ data: null, error: null });
  order.mockReset();
  order.mockResolvedValue({ data: [linha], error: null });
  select.mockClear();
  from.mockClear();
  refresh.mockReset();
});

test("criar envia centavos inteiros, dia numérico e categoria vazia como null", async () => {
  const user = userEvent.setup();
  montar();
  await preencher(user);
  await user.selectOptions(screen.getByLabelText("Forma (à vista)"), "DEBITO");
  await user.clear(screen.getByLabelText("Todo dia"));
  await user.type(screen.getByLabelText("Todo dia"), "17");
  await user.selectOptions(screen.getByLabelText("Categoria"), "");
  await user.click(screen.getByRole("button", { name: "Criar recorrência" }));

  expect(rpc).toHaveBeenCalledExactlyOnceWith("criar_recorrencia", {
    p_descricao: "Aluguel", p_valor: 123456, p_tipo: "DESPESA",
    p_forma_pagamento: "DEBITO", p_dia_do_mes: 17, p_categoria_id: null,
  });
  expect(Number.isInteger((rpc.mock.calls[0][1] as { p_valor: number }).p_valor)).toBe(true);
  expect(from).toHaveBeenCalledWith("recorrencias");
  await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
});

test.each([true, false])("alternar inverte p_ativa quando ativa é %s", async (ativa) => {
  const user = userEvent.setup();
  order.mockResolvedValue({ data: [{ ...linha, ativa }], error: null });
  montar();
  await user.click(await screen.findByRole("button", { name: ativa ? "Pausar" : "Reativar" }));
  expect(rpc).toHaveBeenCalledExactlyOnceWith("alternar_recorrencia", {
    p_recorrencia_id: "rec-1", p_ativa: !ativa,
  });
});

test("excluir chama a RPC somente depois da confirmação pela UI", async () => {
  const user = userEvent.setup();
  montar();
  await user.click(await screen.findByRole("button", { name: "Excluir" }));
  const dialogo = await screen.findByRole("dialog", { name: "Excluir recorrência" });
  expect(rpc).not.toHaveBeenCalled();
  await user.click(within(dialogo).getByRole("button", { name: "Excluir" }));
  await waitFor(() => expect(rpc).toHaveBeenCalledExactlyOnceWith("excluir_recorrencia", {
    p_recorrencia_id: "rec-1",
  }));
});

test("cancelar a exclusão não chama RPC", async () => {
  const user = userEvent.setup();
  montar();
  await user.click(await screen.findByRole("button", { name: "Excluir" }));
  const dialogo = await screen.findByRole("dialog", { name: "Excluir recorrência" });
  await user.click(within(dialogo).getByRole("button", { name: "Cancelar" }));
  expect(rpc).not.toHaveBeenCalled();
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

test("valor inválido não chama RPC", async () => {
  const user = userEvent.setup();
  montar();
  await preencher(user, "abc");
  await user.click(screen.getByRole("button", { name: "Criar recorrência" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Valor inválido.");
  expect(rpc).not.toHaveBeenCalled();
  expect(refresh).not.toHaveBeenCalled();
});

test.each(["criar", "alternar", "excluir"])("%s exibe mensagem e hint de erro FW", async (acao) => {
  const user = userEvent.setup();
  rpc.mockResolvedValue({ data: null, error: {
    code: "FW409", message: "Recorrência bloqueada.", hint: "Confira os lançamentos existentes.",
  } });
  montar();
  if (acao === "criar") {
    await preencher(user);
    await user.click(screen.getByRole("button", { name: "Criar recorrência" }));
  } else if (acao === "alternar") {
    await user.click(await screen.findByRole("button", { name: "Pausar" }));
  } else {
    await user.click(await screen.findByRole("button", { name: "Excluir" }));
    const dialogo = await screen.findByRole("dialog", { name: "Excluir recorrência" });
    await user.click(within(dialogo).getByRole("button", { name: "Excluir" }));
  }
  const alerta = await screen.findByRole("alert");
  expect(alerta).toHaveTextContent("Recorrência bloqueada.");
  expect(alerta).toHaveTextContent("Confira os lançamentos existentes.");
  expect(refresh).not.toHaveBeenCalled();
});
