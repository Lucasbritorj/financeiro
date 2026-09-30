import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import SairBotao from "@/components/sair-botao";
import NavLinks from "@/components/nav-links";
import TemaToggle from "@/components/tema-toggle";
import FeedbackProvider from "@/components/feedback";
import ComandoMenu from "@/components/comando-menu";
import NavegacaoMovel from "@/components/navegacao-movel";

// Nav principal = fluxo do assistente. Contas a pagar (faturas + boletos) é
// fluxo primário — gasto fixo mensal. Cartões ficam na nav secundária.
const NAV_PRINCIPAL = [
  { href: "/dashboard", rotulo: "Dashboard" },
  { href: "/analise", rotulo: "Análise" },
  { href: "/transacoes", rotulo: "Transações" },
  { href: "/faturas", rotulo: "Contas a pagar" },
  { href: "/categorias", rotulo: "Categorias" },
  { href: "/importar", rotulo: "Importar" },
  { href: "/cofrinhos", rotulo: "Cofrinhos" },
];
const NAV_SECUNDARIA = [{ href: "/cartoes", rotulo: "Cartões" }];

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
    <FeedbackProvider>
    <div className="min-h-screen">
      <header
        className="cabecalho-atelie sticky top-0 z-20 border-b"
        style={{ borderColor: "var(--borda)" }}
      >
        <nav className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-5 gap-y-1 px-4 py-3">
          <span className="serifa mr-1 text-lg font-semibold" style={{ color: "var(--giz)" }}>
            Ateliê
          </span>
          <div className="hidden items-center gap-x-5 gap-y-1 md:flex">
            <NavLinks itens={NAV_PRINCIPAL} />
            <span aria-hidden style={{ color: "var(--borda-forte)" }}>·</span>
            <NavLinks itens={NAV_SECUNDARIA} variante="secundaria" />
          </div>
          <NavegacaoMovel itens={[...NAV_PRINCIPAL, ...NAV_SECUNDARIA]} />
          <div className="ml-auto flex items-center gap-3 text-sm" style={{ color: "var(--grafite)" }}>
            <span className="hidden md:inline">{user.email}</span>
            <ComandoMenu />
            <TemaToggle />
            <SairBotao />
          </div>
        </nav>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-8">{children}</main>
    </div>
    </FeedbackProvider>
  );
}
