import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import SairBotao from "@/components/sair-botao";
import NavLinks from "@/components/nav-links";
import TemaToggle from "@/components/tema-toggle";

// Nav principal = fluxo do assistente. Faturas/cartões estão congelados
// (modelo §1): acessíveis, mas fora do fluxo principal.
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
        style={{
          borderColor: "var(--borda)",
          background: "color-mix(in oklab, var(--tinta) 88%, transparent)",
          backdropFilter: "blur(8px)",
        }}
      >
        <nav className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-5 gap-y-1 px-4 py-3">
          <span className="serifa mr-1 text-lg font-semibold" style={{ color: "var(--giz)" }}>
            Ateliê
          </span>
          <NavLinks itens={NAV_PRINCIPAL} />
          <span aria-hidden style={{ color: "var(--borda-forte)" }}>
            ·
          </span>
          <NavLinks itens={NAV_SECUNDARIA} variante="secundaria" />
          <div className="ml-auto flex items-center gap-3 text-sm" style={{ color: "var(--grafite)" }}>
            <span className="hidden md:inline">{user.email}</span>
            <TemaToggle />
            <SairBotao />
          </div>
        </nav>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-8">{children}</main>
    </div>
  );
}
