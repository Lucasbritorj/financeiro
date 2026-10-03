import { test, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import FeedbackProvider from "@/components/feedback";
import { hojeSaoPaulo } from "@/lib/data";

type Resposta = { data: unknown; error: unknown };
const rpc = vi.fn<(nome: string, params: unknown) => Promise<Resposta>>();
const refresh = vi.fn();

vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ rpc }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

const { default: NovaTransacaoForm } = await import("@/components/nova-transacao-form");

function montar() {
  render(
    <FeedbackProvider>
      <NovaTransacaoForm
        cartoes={[{ id: "cartao-1", nome: "Nubank" }, { id: "cartao-2", nome: "Outro cartão" }]}
        categorias={[
          { id: "cat-mercado", nome: "Mercado", tipo: "DESPESA" },
          { id: "cat-salario", nome: "Salário", tipo: "RECEITA" },
        ]}
      />
    </FeedbackProvider>,
  );
  return userEvent.setup();
}

async function preencher(user: ReturnType<typeof userEvent.setup>, valor = "1.234,56") {
  await user.type(screen.getByLabelText(/Descrição/), "Mercado");
  await user.type(screen.getByLabelText(/^Valor/), valor);
}

function registrar() {
  return screen.getByRole("button", { name: /^Registrar/ });
}

beforeEach(() => {
  rpc.mockReset();
  rpc.mockResolvedValue({ data: null, error: null });
  refresh.mockReset();
  // 01:30 UTC ainda é o dia anterior em São Paulo: detecta default em UTC.
  // Só Date é falso; userEvent e os timers do provider continuam reais.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-08-11T01:30:00Z"));
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

test("PIX converte reais em centavos inteiros e usa hoje em São Paulo", async () => {
  const user = montar();
  expect(screen.getByLabelText(/Data da compra/)).toHaveValue(hojeSaoPaulo());
  expect(hojeSaoPaulo()).toBe("2026-08-10");
  await preencher(user);
  // Preenche crédito antes de trocar: PIX deve descartar cartão e parcelas.
  await user.clear(screen.getByLabelText(/Parcelas/));
  await user.type(screen.getByLabelText(/Parcelas/), "3");
  await user.selectOptions(screen.getByLabelText(/Forma de pagamento/), "PIX");
  await user.click(registrar());

  expect(rpc).toHaveBeenCalledExactlyOnceWith("processar_transacao_completa", {
    p_descricao: "Mercado", p_valor_total: 123456, p_tipo: "DESPESA",
    p_forma_pagamento: "PIX", p_cartao_id: null, p_num_parcelas: 1,
    p_data_compra: hojeSaoPaulo(),
  });
  expect(Number.isInteger((rpc.mock.calls[0][1] as { p_valor_total: number }).p_valor_total)).toBe(true);
  expect(refresh).toHaveBeenCalledTimes(1);
});

test("crédito envia o cartão escolhido e três parcelas com centavos", async () => {
  const user = montar();
  await preencher(user);
  await user.selectOptions(screen.getByLabelText(/Forma de pagamento/), "CREDITO");
  await user.selectOptions(screen.getByLabelText(/Cartão/), "cartao-2");
  await user.clear(screen.getByLabelText(/Parcelas/));
  await user.type(screen.getByLabelText(/Parcelas/), "3");
  await user.click(registrar());

  expect(rpc).toHaveBeenCalledExactlyOnceWith("processar_transacao_completa", expect.objectContaining({
    p_valor_total: 123456, p_forma_pagamento: "CREDITO",
    p_cartao_id: "cartao-2", p_num_parcelas: 3,
  }));
});

test("categoria manual é atribuída ao id retornado pela criação", async () => {
  rpc.mockResolvedValueOnce({ data: { transacao_id: "tx-nova", parcelas_criadas: 1 }, error: null });
  const user = montar();
  await preencher(user);
  await user.selectOptions(screen.getByLabelText(/Forma de pagamento/), "PIX");
  await user.selectOptions(screen.getByLabelText(/Categoria/), "cat-mercado");
  await user.click(registrar());

  expect(rpc).toHaveBeenCalledTimes(2);
  expect(rpc).toHaveBeenNthCalledWith(1, "processar_transacao_completa", expect.objectContaining({ p_valor_total: 123456 }));
  // Esta RPC recebe apenas ids; o dinheiro pertence ao payload da criação.
  expect(rpc).toHaveBeenNthCalledWith(2, "definir_categoria_transacao", {
    p_transacao_id: "tx-nova", p_categoria_id: "cat-mercado",
  });
});

test("boleto envia centavos e vencimento e força despesa após receita", async () => {
  const user = montar();
  await preencher(user);
  await user.selectOptions(screen.getByLabelText(/^Tipo/), "RECEITA");
  await user.selectOptions(screen.getByLabelText(/Forma de pagamento/), "BOLETO");
  expect(screen.queryByLabelText(/^Tipo/)).not.toBeInTheDocument();
  expect(screen.getByLabelText(/Categoria/)).toHaveTextContent("Mercado");
  expect(screen.getByLabelText(/Categoria/)).not.toHaveTextContent("Salário");
  await user.type(screen.getByLabelText(/Vencimento/), "2026-08-20");
  await user.click(registrar());

  expect(rpc).toHaveBeenCalledExactlyOnceWith("criar_boleto", {
    p_descricao: "Mercado", p_valor: 123456, p_data_vencimento: "2026-08-20",
    p_data_competencia: hojeSaoPaulo(), p_categoria_id: null,
  });
  expect(Number.isInteger((rpc.mock.calls[0][1] as { p_valor: number }).p_valor)).toBe(true);
  await user.selectOptions(screen.getByLabelText(/Forma de pagamento/), "PIX");
  expect(screen.getByLabelText(/^Tipo/)).toHaveValue("DESPESA");
});

test("valor inválido exibe erro sem chamar RPC", async () => {
  const user = montar();
  await preencher(user, "abc");
  await user.click(registrar());
  expect(await screen.findByRole("alert")).toHaveTextContent("Valor inválido.");
  expect(rpc).not.toHaveBeenCalled();
  expect(refresh).not.toHaveBeenCalled();
});

test("boleto sem vencimento é bloqueado pela validação HTML", async () => {
  const user = montar();
  await preencher(user);
  await user.selectOptions(screen.getByLabelText(/Forma de pagamento/), "BOLETO");
  await user.click(registrar());
  expect(screen.getByLabelText(/Vencimento/)).toBeRequired();
  expect(screen.getByLabelText(/Vencimento/)).toBeInvalid();
  expect(rpc).not.toHaveBeenCalled();
  expect(refresh).not.toHaveBeenCalled();
});

test.each(["PIX", "BOLETO"])("erro FW409 e hint aparecem na tela para %s", async (forma) => {
  rpc.mockResolvedValue({ data: null, error: {
    code: "FW409", message: "Fatura já paga.", hint: "Estorne o pagamento antes de tentar novamente.",
  } });
  const user = montar();
  await preencher(user);
  await user.selectOptions(screen.getByLabelText(/Forma de pagamento/), forma);
  if (forma === "BOLETO") await user.type(screen.getByLabelText(/Vencimento/), "2026-08-20");
  await user.click(registrar());

  const alerta = await screen.findByRole("alert");
  expect(alerta).toHaveTextContent("Fatura já paga.");
  expect(alerta).toHaveTextContent("Estorne o pagamento antes de tentar novamente.");
  expect(rpc).toHaveBeenCalledTimes(1);
  expect(refresh).not.toHaveBeenCalled();
});
