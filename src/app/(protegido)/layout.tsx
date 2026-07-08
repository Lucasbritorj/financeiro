import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import SairBotao from "@/components/sair-botao";

// Nav principal = fluxo do assistente (dashboard, transações, categorias,
// importar, cofrinhos). Faturas/cartões estão congelados (modelo §1):
// continuam acessíveis, mas fora do fluxo principal.
const NAV_PRINCIPAL = [
  { href: "/dashboard", rotulo: "Dashboard" },
  { href: "/analise", rotulo: "Análise" },
  { href: "/transacoes", rotulo: "Transações" },
  { href: "/categorias", rotulo: "Categorias" },
  { href: "/importar", rotulo: "Importar" },
  { href: "/cofrinhos", rotulo: "Cofrinhos" },
];
const NAV_SECUNDARIA = [
  { href: "/cartoes", rotulo: "Cartões" },
  { href: "/faturas", rotulo: "Faturas" },
];

export default async function ProtegidoLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return (
    <div className="min-h-screen">
      <header
        className="sticky top-0 z-20 border-b"
        style={{ borderColor: "var(--borda)", background: "var(--tinta)" }}
      >
        <nav className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-5 gap-y-1 px-4 py-3">
          <span className="serifa text-lg font-semibold" style={{ color: "var(--giz)" }}>
            Ateliê
          </span>
          {NAV_PRINCIPAL.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="text-sm transition-colors hover:text-[var(--ouro)]"
            >
              {item.rotulo}
            </Link>
          ))}
          <span aria-hidden style={{ color: "var(--borda-forte)" }}>
            ·
          </span>
          {NAV_SECUNDARIA.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="text-xs transition-colors hover:text-[var(--ouro)]"
              style={{ color: "var(--grafite)" }}
            >
              {item.rotulo}
            </Link>
          ))}
          <div className="ml-auto flex items-center gap-3 text-sm" style={{ color: "var(--grafite)" }}>
            <span className="hidden sm:inline">{user.email}</span>
            <SairBotao />
          </div>
        </nav>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-8">{children}</main>
    </div>
  );
}
