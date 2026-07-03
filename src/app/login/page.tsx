"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const router = useRouter();
  const [modo, setModo] = useState<"entrar" | "cadastrar">("entrar");
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [pendente, setPendente] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);
    setAviso(null);
    setPendente(true);
    const supabase = createClient();

    if (modo === "entrar") {
      const { error } = await supabase.auth.signInWithPassword({ email, password: senha });
      setPendente(false);
      if (error) {
        setErro(error.message);
        return;
      }
      router.push("/transacoes");
      router.refresh();
    } else {
      const { data, error } = await supabase.auth.signUp({ email, password: senha });
      setPendente(false);
      if (error) {
        setErro(error.message);
        return;
      }
      if (data.session) {
        router.push("/transacoes");
        router.refresh();
      } else {
        setAviso("Cadastro criado. Confirme o e-mail antes de entrar.");
      }
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-zinc-50 px-4 text-zinc-900">
      <div className="w-full max-w-sm rounded-lg border border-zinc-200 bg-white p-6">
        <h1 className="mb-1 text-lg font-semibold">Financeiro</h1>
        <p className="mb-4 text-sm text-zinc-500">
          {modo === "entrar" ? "Entre na sua conta" : "Crie sua conta"}
        </p>
        <form onSubmit={enviar} className="grid gap-3">
          <label className="text-sm">
            E-mail
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="mt-1 w-full rounded border border-zinc-300 px-2 py-1.5"
            />
          </label>
          <label className="text-sm">
            Senha
            <input
              type="password"
              value={senha}
              onChange={(e) => setSenha(e.target.value)}
              required
              minLength={6}
              className="mt-1 w-full rounded border border-zinc-300 px-2 py-1.5"
            />
          </label>
          {erro && <p className="text-sm text-red-600">{erro}</p>}
          {aviso && <p className="text-sm text-emerald-700">{aviso}</p>}
          <button
            type="submit"
            disabled={pendente}
            className="rounded bg-zinc-900 px-4 py-2 text-sm text-white hover:bg-zinc-700 disabled:opacity-50"
          >
            {pendente ? "Aguarde..." : modo === "entrar" ? "Entrar" : "Cadastrar"}
          </button>
        </form>
        <button
          onClick={() => setModo(modo === "entrar" ? "cadastrar" : "entrar")}
          className="mt-3 text-sm text-zinc-500 hover:underline"
        >
          {modo === "entrar" ? "Não tem conta? Cadastre-se" : "Já tem conta? Entre"}
        </button>
      </div>
    </main>
  );
}
