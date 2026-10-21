import { beforeEach, expect, test, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), refresh: vi.fn() }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ rpc: mocks.rpc }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
import EditarCadastro from "@/components/editar-cadastro";
beforeEach(() => { vi.clearAllMocks(); mocks.rpc.mockResolvedValue({ error: null }); });
test.each<{ tipo: "cartao" | "cofrinho" | "categoria" | "recorrencia"; valores: Record<string, string>; rpc: string; campo: string; valor: string; args: Record<string, string | number | null> }>([
  { tipo: "cartao" as const, valores: { nome: "Banco", limite_total: "1000,01", dia_fechamento: "20", dia_vencimento: "10" }, rpc: "editar_cartao", campo: "Limite (R$)", valor: "2000,02", args: { p_limite_total: 200002, p_cartao_id: "id" } },
  { tipo: "cofrinho" as const, valores: { nome: "Meta", valor_alvo: "1000,00", data_alvo: "", horizonte: "MEDIO" }, rpc: "editar_cofrinho", campo: "Valor-alvo (R$)", valor: "1500,01", args: { p_valor_alvo: 150001, p_data_alvo: null } },
  { tipo: "categoria" as const, valores: { nome: "Mercado", cor: "#D9A24E", icone: "house" }, rpc: "editar_categoria", campo: "Nome", valor: "Compras", args: { p_nome: "Compras", p_icone: "house" } },
  { tipo: "recorrencia" as const, valores: { descricao: "Aluguel", valor: "1000,00", tipo: "DESPESA", forma_pagamento: "PIX", dia_do_mes: "5", categoria_id: "" }, rpc: "editar_recorrencia", campo: "Valor (R$)", valor: "1200,01", args: { p_valor: 120001, p_categoria_id: null } },
])("edita $tipo sem converter dinheiro incorretamente", async ({ tipo, valores, rpc, campo, valor, args }) => {
  const user = userEvent.setup();
  render(<EditarCadastro tipo={tipo} id="id" valores={valores} />);
  await user.click(screen.getByRole("button", { name: "Editar" }));
  await user.clear(screen.getByLabelText(campo));
  await user.type(screen.getByLabelText(campo), valor);
  await user.click(screen.getByRole("button", { name: "Salvar alterações" }));
  expect(mocks.rpc).toHaveBeenCalledWith(rpc, expect.objectContaining(args));
  expect(mocks.refresh).toHaveBeenCalledOnce();
});
test("recusa do banco preserva formulário e dados para corrigir", async () => {
  mocks.rpc.mockResolvedValue({ error: { code:'FW409', message: "Limite comprometido", hint: "Quite as parcelas." } });
  const user = userEvent.setup();
  render(<EditarCadastro tipo="cartao" id="id" valores={{ nome: "Banco", limite_total: "1000,00", dia_fechamento: "20", dia_vencimento: "10" }} />);
  await user.click(screen.getByRole("button", { name: "Editar" }));
  await user.click(screen.getByRole("button", { name: "Salvar alterações" }));
  expect(screen.getByRole("alert")).toHaveTextContent("Limite comprometido");
  expect(screen.getByLabelText("Nome")).toHaveValue("Banco");
  expect(mocks.refresh).not.toHaveBeenCalled();
});
