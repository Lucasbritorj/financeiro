import { test, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({ usePathname: () => "/cofrinhos" }));

const NavegacaoMovel = (await import("@/components/navegacao-movel")).default;

test("menu móvel expõe links e anuncia a rota ativa", () => {
  render(<NavegacaoMovel itens={[
    { href: "/dashboard", rotulo: "Dashboard" },
    { href: "/cofrinhos", rotulo: "Cofrinhos" },
  ]} />);

  expect(screen.getByText("Menu").closest("summary")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Cofrinhos" })).toHaveAttribute("aria-current", "page");
  expect(screen.getByRole("link", { name: "Dashboard" })).not.toHaveAttribute("aria-current");
});