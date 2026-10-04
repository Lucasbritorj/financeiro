import { test, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import FeedbackProvider from "@/components/feedback";

type Resposta = { data: unknown; error: unknown };
const rpc = vi.fn<(nome: string, params: unknown) => Promise<Resposta>>();
const refresh = vi.fn();
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ rpc }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
const { default: CofrinhoCard } = await import("@/components/cofrinho-card");

function montar() {
  render(
    <FeedbackProvider>
      <CofrinhoCard
        cofrinho={{ id: "cofre-1", nome: "Reserva", cor: null, valor_alvo: 500000,
          saldo_atual: 200000, data_alvo: null, horizonte: "CURTO" }}
        movimentacoes={[]}
        hojeISO="2026-10-03"
      />
    </FeedbackProvider>,
  );
}

beforeEach(() => {
  rpc.mockReset();
  rpc.mockResolvedValue({ data: null, error: null });
  refresh.mockReset();
});

test.each([
  ["APORTE", "aportar_cofrinho", "1.234,56", 123456],
  ["RESGATE", "resgatar_cofrinho", "12,34", 1234],
])("%s envia centavos inteiros para %s", async (modo, nomeRpc, valor, centavos) => {
  const user = userEvent.setup();
  montar();
  await user.selectOptions(screen.getByLabelText("Tipo de movimentação"), modo);
  await user.type(screen.getByLabelText("Valor da movimentação"), valor);
  await user.click(screen.getByRole("button", { name: "Confirmar" }));

  expect(rpc).toHaveBeenCalledExactlyOnceWith(nomeRpc, {
    p_cofrinho_id: "cofre-1", p_valor: centavos,
  });
  expect(Number.isInteger((rpc.mock.calls[0][1] as { p_valor: number }).p_valor)).toBe(true);
  await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
  expect(screen.getByLabelText("Valor da movimentação")).toHaveValue("");
});

test.each(["APORTE", "RESGATE"])("%s recusa valor inválido antes da RPC", async (modo) => {
  const user = userEvent.setup();
  montar();
  await user.selectOptions(screen.getByLabelText("Tipo de movimentação"), modo);
  await user.type(screen.getByLabelText("Valor da movimentação"), "abc");
  await user.click(screen.getByRole("button", { name: "Confirmar" }));
  expect(await screen.findByText("Valor inválido.")).toBeInTheDocument();
  expect(rpc).not.toHaveBeenCalled();
  expect(refresh).not.toHaveBeenCalled();
});

test.each(["APORTE", "RESGATE"])("%s exibe mensagem e hint de erro FW409", async (modo) => {
  const user = userEvent.setup();
  rpc.mockResolvedValue({ data: null, error: {
    code: "FW409", message: "Movimentação bloqueada.", hint: "Confira o saldo disponível.",
  } });
  montar();
  await user.selectOptions(screen.getByLabelText("Tipo de movimentação"), modo);
  await user.type(screen.getByLabelText("Valor da movimentação"), "10,00");
  await user.click(screen.getByRole("button", { name: "Confirmar" }));
  expect(await screen.findByText(/Movimentação bloqueada\./)).toHaveTextContent("Confira o saldo disponível.");
  expect(refresh).not.toHaveBeenCalled();
});
