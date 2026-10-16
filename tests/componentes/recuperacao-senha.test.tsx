import { beforeEach, expect, test, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
const mocks = vi.hoisted(() => ({ reset: vi.fn(), update: vi.fn(), user: vi.fn() }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ auth: {
  resetPasswordForEmail: mocks.reset, updateUser: mocks.update, getUser: mocks.user,
} }) }));
import RecuperacaoSenha from "@/components/recuperacao-senha";
beforeEach(() => {
  vi.clearAllMocks();
  mocks.reset.mockResolvedValue({ error: null });
  mocks.update.mockResolvedValue({ error: null });
  mocks.user.mockResolvedValue({ data: { user: { id: "teste" } }, error: null });
});
test("solicita link na origem atual com mensagem que não revela cadastro", async () => {
  const user = userEvent.setup();
  render(<RecuperacaoSenha modo="solicitar" />);
  await user.type(screen.getByLabelText("E-mail"), "teste@example.com");
  await user.click(screen.getByRole("button", { name: "Enviar link" }));
  expect(mocks.reset).toHaveBeenCalledWith("teste@example.com", { redirectTo: `${window.location.origin}/login/confirmar` });
  expect(screen.getByRole("status")).toHaveTextContent("Se houver uma conta");
});
test("senhas diferentes não são enviadas; senha confirmada é salva", async () => {
  const user = userEvent.setup();
  render(<RecuperacaoSenha modo="definir" />);
  await screen.findByLabelText("Nova senha");
  await user.type(screen.getByLabelText("Nova senha"), "senha-teste-123");
  await user.type(screen.getByLabelText("Confirmar senha"), "senha-teste-456");
  await user.click(screen.getByRole("button", { name: "Salvar senha" }));
  expect(mocks.update).not.toHaveBeenCalled();
  expect(screen.getByRole("alert")).toHaveTextContent("senhas não coincidem");
  await user.clear(screen.getByLabelText("Confirmar senha"));
  await user.type(screen.getByLabelText("Confirmar senha"), "senha-teste-123");
  await user.click(screen.getByRole("button", { name: "Salvar senha" }));
  expect(mocks.update).toHaveBeenCalledWith({ password: "senha-teste-123" });
  expect(screen.getByRole("status")).toHaveTextContent("Senha atualizada");
});
test("sessão ausente não oferece alteração de senha", async () => {
  mocks.user.mockResolvedValue({ data: { user: null }, error: null });
  render(<RecuperacaoSenha modo="definir" />);
  expect(await screen.findByRole("alert")).toHaveTextContent("link");
  expect(screen.queryByRole("button", { name: "Salvar senha" })).not.toBeInTheDocument();
});

test("recuperação respeita o limite de senha do login, inclusive envio programático", async () => {
  render(<RecuperacaoSenha modo="definir" />);
  const senha = await screen.findByLabelText("Nova senha");
  const confirmacao = screen.getByLabelText("Confirmar senha");
  expect(senha).toHaveAttribute("maxlength", "128");
  expect(confirmacao).toHaveAttribute("maxlength", "128");
  fireEvent.change(senha, { target: { value: "a".repeat(129) } });
  fireEvent.change(confirmacao, { target: { value: "a".repeat(129) } });
  fireEvent.submit(senha.closest("form")!);
  expect(mocks.update).not.toHaveBeenCalled();
  expect(screen.getByRole("alert")).toHaveTextContent("no máximo 128");
  fireEvent.change(senha, { target: { value: "a".repeat(128) } });
  fireEvent.change(confirmacao, { target: { value: "a".repeat(128) } });
  fireEvent.submit(senha.closest("form")!);
  expect(mocks.update).toHaveBeenCalledWith({ password: "a".repeat(128) });
  await screen.findByRole("status");
});
test("erro de rede libera nova tentativa", async () => {
  mocks.reset.mockRejectedValueOnce(new Error("Falha de rede"));
  const user = userEvent.setup();
  render(<RecuperacaoSenha modo="solicitar" />);
  await user.type(screen.getByLabelText("E-mail"), "teste@example.com");
  await user.click(screen.getByRole("button", { name: "Enviar link" }));
  expect(screen.getByRole("alert")).toHaveTextContent("Falha de rede");
  expect(screen.getByRole("button", { name: "Enviar link" })).toBeEnabled();
});
