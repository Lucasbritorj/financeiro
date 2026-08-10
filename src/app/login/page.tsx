"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { mensagemDeErro } from "@/lib/erros";

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
        setErro(mensagemDeErro(error));
        return;
      }
      router.push("/dashboard");
      router.refresh();
    } else {
      const { data, error } = await supabase.auth.signUp({ email, password: senha });
      setPendente(false);
      if (error) {
        setErro(mensagemDeErro(error));
        return;
      }
      if (data.session) {
        router.push("/dashboard");
        router.refresh();
      } else {
        setAviso("Cadastro criado. Confirme o e-mail antes de entrar.");
      }
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="vidro-soberano w-full max-w-sm p-8">
        <p className="eyebrow">seu dinheiro, com clareza</p>
        <h1 className="serifa mt-1 text-3xl font-semibold" style={{ color: "var(--giz)" }}>
          Ateliê
        </h1>
        <p className="mb-6 mt-3 text-sm" style={{ color: "var(--grafite)" }}>
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
              className="campo-soberano"
            />
          </label>
          <label className="text-sm">
            Senha
            <input
              type="password"
              value={senha}
              onChange={(e) => setSenha(e.target.value)}
              required
              minLength={8}
              className="campo-soberano"
            />
          </label>
          {erro && (
            <p className="text-sm" style={{ color: "var(--telha)" }}>
              {erro}
            </p>
          )}
          {aviso && (
            <p className="text-sm" style={{ color: "var(--verde)" }}>
              {aviso}
            </p>
          )}
          <button type="submit" disabled={pendente} className="botao-soberano mt-1 text-sm">
            {pendente ? "Aguarde..." : modo === "entrar" ? "Entrar" : "Cadastrar"}
          </button>
        </form>
        <button
          onClick={() => setModo(modo === "entrar" ? "cadastrar" : "entrar")}
          className="mt-4 text-sm transition-colors hover:text-[var(--ouro)]"
          style={{ color: "var(--grafite)" }}
        >
          {modo === "entrar" ? "Não tem conta? Cadastre-se" : "Já tem conta? Entre"}
        </button>
      </div>
    </main>
  );
}
