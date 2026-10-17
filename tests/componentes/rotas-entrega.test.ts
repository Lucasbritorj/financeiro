import { beforeEach, expect, test, vi } from "vitest";
const mocks = vi.hoisted(() => ({ user: vi.fn(), exchange: vi.fn(), from: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser: mocks.user, exchangeCodeForSession: mocks.exchange }, from: mocks.from }) }));
import { GET as exportar } from "@/app/(protegido)/transacoes/exportar/route";
import { GET as confirmar } from "@/app/login/confirmar/route";
beforeEach(() => {
  vi.clearAllMocks();
  mocks.user.mockResolvedValue({ data: { user: { id: "u" } }, error: null });
  mocks.exchange.mockResolvedValue({ error: null });
});
test("exportação exige sessão e não consulta dados sem ela", async () => {
  mocks.user.mockResolvedValue({ data: { user: null }, error: null });
  const resposta = await exportar(new Request("http://localhost/transacoes/exportar"));
  expect(resposta.status).toBe(401);
  expect(mocks.from).not.toHaveBeenCalled();
});
test("CSV aplica filtro em todas as páginas e não permite cache", async () => {
  const chamadas = vi.fn();
  let pagina = 0;
  const builder = { select: () => builder, order: () => builder, limit: () => builder, gt: () => builder, eq: chamadas,
    abortSignal: async () => ({ data: pagina++ === 0 ? [{ id: "1", descricao: "Teste", valor_total: 10001, data_compra: "2026-10-01", tipo: "DESPESA", forma_pagamento: "PIX", natureza: "CONSUMO", categorias: null }] : [], error: null }),
  };
  chamadas.mockReturnValue(builder);
  mocks.from.mockReturnValue(builder);
  const resposta = await exportar(new Request("http://localhost/transacoes/exportar?tipo=DESPESA"));
  expect(resposta.status).toBe(200);
  expect(await resposta.text()).toContain("100,01");
  expect(resposta.headers.get("cache-control")).toContain("no-store");
  expect(chamadas).toHaveBeenCalledTimes(2);
});
test("erro intermediário devolve erro em vez de baixar CSV incompleto", async () => {
  let pagina = 0;
  const builder = { select: () => builder, order: () => builder, limit: () => builder, gt: () => builder,
    abortSignal: async () => pagina++ === 0 ? { data: [{ id: "1" }], error: null } : { data: null, error: { message: "timeout" } },
  };
  mocks.from.mockReturnValue(builder);
  const resposta = await exportar(new Request("http://localhost/transacoes/exportar"));
  expect(resposta.status).toBe(503);
  expect(resposta.headers.get("content-disposition")).toBeNull();
});
test("callback usa destino fixo e remove o código da URL", async () => {
  const resposta = await confirmar(new Request("http://localhost/login/confirmar?code=teste&next=https://externo.test"));
  expect(mocks.exchange).toHaveBeenCalledWith("teste");
  expect(resposta.headers.get("location")).toBe("/login/nova-senha");
});
test("callback ausente ou expirado oferece outro link", async () => {
  expect((await confirmar(new Request("http://localhost/login/confirmar"))).headers.get("location")).toContain("/login/recuperar?erro=link");
  expect(mocks.exchange).not.toHaveBeenCalled();
  mocks.exchange.mockResolvedValue({ error: { message: "Expirado" } });
  expect((await confirmar(new Request("http://localhost/login/confirmar?code=expirado"))).headers.get("location")).toContain("/login/recuperar?erro=link");
});
