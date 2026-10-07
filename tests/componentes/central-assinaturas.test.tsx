import { beforeEach, expect, test, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import CentralAssinaturas from "@/components/central-assinaturas";
import FeedbackProvider from "@/components/feedback";

vi.mock("@/lib/data", () => ({ hojeSaoPaulo: () => "2026-10-07" }));

type Resposta = { data: unknown; error: unknown };
const rpc = vi.fn<(nome: string, params: unknown) => Promise<Resposta>>();
const order = vi.fn<() => Promise<Resposta>>();
const eq = vi.fn(() => ({ order }));
const select = vi.fn(() => ({ eq }));
const from = vi.fn(() => ({ select }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ rpc, from }) }));

const streaming = {
  id: "ass-1",
  descricao: "Streaming",
  valor: 3000,
  categoria_id: "cat-1",
  cartao_id: "card-1",
  periodicidade: "MENSAL",
  proxima_data: "2026-11-10",
  status: "ATIVA",
};
const anual = {
  id: "ass-2",
  descricao: "Nuvem",
  valor: 12000,
  categoria_id: null,
  cartao_id: null,
  periodicidade: "ANUAL",
  proxima_data: "2026-12-20",
  status: "ATIVA",
};

function montar() {
  render(
    <FeedbackProvider>
      <CentralAssinaturas
        categorias={[{ id: "cat-1", nome: "Serviços", tipo: "DESPESA" }]}
        cartoes={[{ id: "card-1", nome: "Nubank" }]}
      />
    </FeedbackProvider>,
  );
}

beforeEach(() => {
  rpc.mockReset();
  rpc.mockResolvedValue({ data: null, error: null });
  order.mockReset();
  order.mockResolvedValue({ data: [streaming, anual], error: null });
  eq.mockClear();
  select.mockClear();
  from.mockClear();
});

test("mostra próximas cobranças e totais somente das ativas", async () => {
  montar();
  const proximas = await screen.findByRole("heading", { name: "Próximas cobranças" });
  const secao = proximas.closest("section");
  expect(secao).not.toBeNull();
  expect(within(secao!).getByText("Streaming")).toBeInTheDocument();
  expect(screen.getByText("Custo mensal equivalente").parentElement).toHaveTextContent("R$ 40,00");
  expect(screen.getByText("Projeção anual").parentElement).toHaveTextContent("R$ 480,00");
  expect(eq).toHaveBeenCalledWith("finalidade", "ASSINATURA");
});

test("cadastra assinatura em centavos com categoria e cartão opcionais", async () => {
  const user = userEvent.setup();
  montar();
  await user.click(await screen.findByRole("button", { name: "Nova assinatura" }));
  await user.type(screen.getByLabelText("Serviço ou assinatura"), "Streaming novo");
  await user.type(screen.getByLabelText("Valor por cobrança (R$)"), "49,90");
  await user.selectOptions(screen.getByLabelText("Periodicidade"), "TRIMESTRAL");
  await user.type(screen.getByLabelText("Próxima cobrança"), "2026-12-15");
  await user.selectOptions(screen.getByLabelText("Categoria"), "cat-1");
  await user.selectOptions(screen.getByLabelText("Cartão"), "card-1");
  await user.click(screen.getByRole("button", { name: "Cadastrar assinatura" }));

  await waitFor(() =>
    expect(rpc).toHaveBeenCalledWith("criar_assinatura", {
      p_nome: "Streaming novo",
      p_valor: 4990,
      p_periodicidade: "TRIMESTRAL",
      p_proxima_cobranca: "2026-12-15",
      p_categoria_id: "cat-1",
      p_cartao_id: "card-1",
    }),
  );
});

test("edita assinatura existente", async () => {
  const user = userEvent.setup();
  montar();
  await user.click(await screen.findByRole("button", { name: "Editar Streaming" }));
  const nome = screen.getByLabelText("Serviço ou assinatura");
  await user.clear(nome);
  await user.type(nome, "Streaming Premium");
  await user.click(screen.getByRole("button", { name: "Salvar alterações" }));

  await waitFor(() =>
    expect(rpc).toHaveBeenCalledWith(
      "editar_assinatura",
      expect.objectContaining({
        p_assinatura_id: "ass-1",
        p_nome: "Streaming Premium",
        p_valor: 3000,
      }),
    ),
  );
});

test("edição de assinatura vencida preserva a data persistida", async () => {
  const user = userEvent.setup();
  order.mockResolvedValue({
    data: [{ ...streaming, status: "PAUSADA", proxima_data: "2020-01-31" }],
    error: null,
  });
  montar();

  await user.click(await screen.findByRole("button", { name: "Editar Streaming" }));
  expect(screen.getByLabelText("Próxima cobrança")).toHaveValue("2020-01-31");
  await user.click(screen.getByRole("button", { name: "Salvar alterações" }));

  await waitFor(() =>
    expect(rpc).toHaveBeenCalledWith(
      "editar_assinatura",
      expect.objectContaining({
        p_assinatura_id: "ass-1",
        p_proxima_cobranca: "2020-01-31",
      }),
    ),
  );
  expect(screen.queryByDisplayValue("2026-10-07")).not.toBeInTheDocument();
});

test("motor atualiza a agenda e não mostra data vencida como próxima", async () => {
  const vencida = {
    ...streaming,
    id: "ass-vencida",
    descricao: "Antiga",
    proxima_data: "2020-01-31",
  };
  const atualizada = { ...vencida, proxima_data: "2026-12-01" };
  let passagens = 0;
  rpc.mockImplementation(async (nome: string) => {
    if (nome === "aplicar_recorrencias") {
      passagens += 1;
      return {
        data: { pendentes: passagens < 2, transacoes_criadas: 0 },
        error: null,
      };
    }
    return { data: null, error: null };
  });
  order.mockImplementation(async () => ({
    data: [rpc.mock.calls.filter(([nome]) => nome === "aplicar_recorrencias").length >= 2
      ? atualizada
      : vencida],
    error: null,
  }));

  montar();

  const titulo = await screen.findByRole("heading", { name: "Próximas cobranças" });
  const secao = titulo.closest("section");
  expect(secao).not.toBeNull();
  expect(within(secao!).getByText(/01\/12\/2026/)).toBeInTheDocument();
  expect(screen.queryByText(/31\/01\/2020/)).not.toBeInTheDocument();
  expect(screen.queryByText("agenda pendente no motor")).not.toBeInTheDocument();
  expect(passagens).toBe(2);
});

test("pausa e cancela somente pelas RPCs de status", async () => {
  const user = userEvent.setup();
  montar();
  await user.click(await screen.findByRole("button", { name: "Pausar Streaming" }));
  expect(rpc).toHaveBeenCalledWith("alterar_status_assinatura", {
    p_assinatura_id: "ass-1",
    p_status: "PAUSADA",
  });

  await user.click(screen.getByRole("button", { name: "Cancelar Streaming" }));
  const dialogo = await screen.findByRole("dialog", { name: "Cancelar assinatura" });
  expect(rpc.mock.calls.filter(([nome]) => nome === "alterar_status_assinatura")).toHaveLength(1);
  await user.click(within(dialogo).getByRole("button", { name: "Cancelar assinatura" }));
  await waitFor(() =>
    expect(rpc).toHaveBeenCalledWith("alterar_status_assinatura", {
      p_assinatura_id: "ass-1",
      p_status: "CANCELADA",
    }),
  );
});

test("erro da migration degrada para aviso sem quebrar a página", async () => {
  order.mockResolvedValue({ data: null, error: { message: "column does not exist" } });
  montar();
  expect(await screen.findByText(/Central de Assinaturas indisponível/)).toBeInTheDocument();
});
