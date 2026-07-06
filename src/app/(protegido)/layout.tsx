import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import SairBotao from "@/components/sair-botao";

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
        className="sticky top-0 z-20 border-b backdrop-blur-xl"
        style={{ borderColor: "var(--vidro-borda)", background: "rgba(6, 8, 10, 0.7)" }}
      >
        <nav className="mx-auto flex max-w-4xl items-center gap-5 px-4 py-3">
          <span className="font-semibold tracking-tight" style={{ color: "var(--acento)" }}>
            Financeiro
          </span>
          <Link href="/dashboard" className="text-sm transition-colors hover:text-[var(--acento)]">
            Dashboard
          </Link>
          <Link href="/transacoes" className="text-sm transition-colors hover:text-[var(--acento)]">
            Transações
          </Link>
          <Link href="/faturas" className="text-sm transition-colors hover:text-[var(--acento)]">
            Faturas
          </Link>
          <Link href="/cartoes" className="text-sm transition-colors hover:text-[var(--acento)]">
            Cartões
          </Link>
          <div className="ml-auto flex items-center gap-3 text-sm" style={{ color: "var(--texto-suave)" }}>
            <span className="hidden sm:inline">{user.email}</span>
            <SairBotao />
          </div>
        </nav>
      </header>
      <main className="mx-auto max-w-4xl px-4 py-8">{children}</main>
    </div>
  );
}
