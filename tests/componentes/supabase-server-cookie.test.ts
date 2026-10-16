import { expect, test, vi } from "vitest";
import { NextResponse } from "next/server";
const mocks = vi.hoisted(() => ({ criar: vi.fn(), set: vi.fn(() => { throw new Error("Cookies da renderização são somente leitura"); }) }));
vi.mock("@supabase/ssr", () => ({ createServerClient: mocks.criar }));
vi.mock("next/headers", () => ({ cookies: async () => ({ getAll: () => [], set: mocks.set }) }));
import { createClient } from "@/lib/supabase/server";
test("callback grava os cookies na resposta de redirecionamento", async () => {
  const response = NextResponse.redirect("http://localhost/login/nova-senha");
  await createClient(response);
  const opcoes = mocks.criar.mock.calls[0][2];
  opcoes.cookies.setAll([{ name: "sessao-teste", value: "fixture", options: { path: "/", sameSite: "lax" } }]);
  expect(response.cookies.get("sessao-teste")?.value).toBe("fixture");
  expect(mocks.set).not.toHaveBeenCalled();
});
