"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { mensagemDeErro, mensagemDeErroAuth } from "@/lib/erros";

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
                        setErro(mensagemDeErroAuth(error, "entrar"));
                        return;
              }
              router.push("/dashboard");
              router.refresh();
      } else {
              const { data, error } = await supabase.auth.signUp({ email, password: senha });
              setPendente(false);
              if (error) {
                        setErro(mensagemDeErroAuth(error, "cadastrar"));
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
                      <p className="eyebrow">seu dinheiro, com clareza</p>p>
                      <h1 className="mt-1 text-2xl font-semibold tracking-tight">
                                Financeiro
                      </h1>h1>
                      <p className="mb-6 mt-3 text-sm" style={{ color: "var(--grafite)" }}>
                        {modo === "entrar" ? "Entre na sua conta" : "Crie sua conta"}
                      </p>p>
                      <form onSubmit={enviar} className="grid gap-3">
                                <label className="text-sm">
                                            E-mail
                                            <input
                                                            type="email"
                                                            value={email}
                                                            onChange={(e) => setEmail(e.target.value)}
                                                            required
                                                            maxLength={254}
                                                            className="campo-soberano"
                                                          />
                                </label>label>
                                <label className="text-sm">
                                            Senha
                                            <input
                                                            type="password"
                                                            value={senha}
                                                            onChange={(e) => setSenha(e.target.value)}
                                                            required
                                                            minLength={modo === "cadastrar" ? 12 : 1}
                                                            maxLength={128}
                                                            className="campo-soberano"
                                                          />
                                </label>label>
                        {erro && (
                      <p className="text-sm" style={{ color: "var(--telha)" }}>
                        {erro}
                      </p>p>
                                )}
                        {aviso && (
                      <p className="text-sm" style={{ color: "var(--verde)" }}>
                        {aviso}
                      </p>p>
                                )}
                                <button
                                              type="submit"
                                              disabled={pendente}
                                              className="botao-soberano mt-2 w-full"
                                            >
                                  {pendente
                                                  ? "Aguarde..."
                                                  : modo === "entrar"
                                                  ? "Entrar"
                                                  : "Cadastrar"}
                                </button>button>
                      </form>form>
                      <div className="mt-6 text-center text-sm">
                                <button
                                              type="button"
                                              onClick={() => {
                                                              setModo(modo === "entrar" ? "cadastrar" : "entrar");
                                                              setErro(null);
                                                              setAviso(null);
                                              }}
                                              className="underline focus:outline-none"
                                              style={{ color: "var(--grafite)" }}
                                            >
                                  {modo === "entrar"
                                                  ? "Não tem conta? Cadastre-se"
                                                  : "Já tem conta? Entre"}
                                </button>button>
                      </div>div>
              </div>div>
        </main>main>
      );
}</main>
