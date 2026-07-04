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
    <div className="min-h-screen bg-zinc-50 text-zinc-900">
      <header className="border-b border-zinc-200 bg-white">
        <nav className="mx-auto flex max-w-4xl items-center gap-5 px-4 py-3">
          <span className="font-semibold">Financeiro</span>
          <Link href="/dashboard" className="text-sm hover:underline">
            Dashboard
          </Link>
          <Link href="/transacoes" className="text-sm hover:underline">
            Transações
          </Link>
          <Link href="/faturas" className="text-sm hover:underline">
            Faturas
          </Link>
          <Link href="/cartoes" className="text-sm hover:underline">
            Cartões
          </Link>
          <div className="ml-auto flex items-center gap-3 text-sm text-zinc-500">
            <span className="hidden sm:inline">{user.email}</span>
            <SairBotao />
          </div>
        </nav>
      </header>
      <main className="mx-auto max-w-4xl px-4 py-8">{children}</main>
    </div>
  );
}
