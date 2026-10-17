"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { mensagemDeErro } from "@/lib/erros";

export default function RecuperacaoSenha({ modo, erroInicial = null }: {
  modo: "solicitar" | "definir"; erroInicial?: string | null;
}) {
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [confirmacao, setConfirmacao] = useState("");
  const [pendente, setPendente] = useState(false);
  const [autorizado, setAutorizado] = useState(modo === "solicitar");
  const [erro, setErro] = useState<string | null>(erroInicial);
  const [aviso, setAviso] = useState<string | null>(null);

  useEffect(() => {
    if (modo !== "definir") return;
    let ativo = true;
    createClient().auth.getUser().then(({ data, error }) => {
      if (!ativo) return;
      if (error || !data.user) setErro("Abra um link de recuperação válido ou solicite outro link.");
      else setAutorizado(true);
    }).catch(() => {
      if (ativo) setErro("Não foi possível validar o link. Solicite outro link e tente novamente.");
    });
    return () => { ativo = false; };
  }, [modo]);

  async function enviar(event: React.FormEvent) {
    event.preventDefault();
    if (pendente || !autorizado) return;
    setErro(null);
    if (modo === "definir" && senha.length > 128) {
      setErro("Use no máximo 128 caracteres.");
      return;
    }
    if (modo === "definir" && (senha.length < 8 || senha !== confirmacao)) {
      setErro(senha.length < 8 ? "Use pelo menos 8 caracteres." : "As senhas não coincidem.");
      return;
    }
    setPendente(true);
    try {
      const auth = createClient().auth;
      const { error } = modo === "solicitar"
        ? await auth.resetPasswordForEmail(email.trim(), { redirectTo: `${window.location.origin}/login/confirmar` })
        : await auth.updateUser({ password: senha });
      if (error) throw error;
      setAviso(modo === "solicitar"
        ? "Se houver uma conta com esse e-mail, você receberá um link. Abra-o neste navegador."
        : "Senha atualizada. Você já pode continuar usando sua conta.");
      setSenha("");
      setConfirmacao("");
    } catch (error) {
      setErro(mensagemDeErro(error));
    } finally {
      setPendente(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <section className="vidro-soberano grid w-full max-w-sm gap-4 p-8">
        <h1 className="serifa text-2xl">{modo === "solicitar" ? "Recuperar senha" : "Definir nova senha"}</h1>
        {erro && <p role="alert" className="text-sm" style={{ color: "var(--telha)" }}>{erro}</p>}
        {aviso && <p role="status" className="text-sm">{aviso}</p>}
        {autorizado && !aviso && <form onSubmit={enviar} className="grid gap-3">
          {modo === "solicitar" ? <label>E-mail
            <input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} className="campo-soberano" />
          </label> : <>
            <label>Nova senha<input type="password" autoComplete="new-password" minLength={8} maxLength={128} required value={senha} onChange={(e) => setSenha(e.target.value)} className="campo-soberano" /></label>
            <label>Confirmar senha<input type="password" autoComplete="new-password" minLength={8} maxLength={128} required value={confirmacao} onChange={(e) => setConfirmacao(e.target.value)} className="campo-soberano" /></label>
          </>}
          <button disabled={pendente} className="botao-soberano">{pendente ? "Aguarde..." : modo === "solicitar" ? "Enviar link" : "Salvar senha"}</button>
        </form>}
        {modo === "definir" && !autorizado && <Link href="/login/recuperar">Solicitar outro link</Link>}
        <Link href={aviso && modo === "definir" ? "/dashboard" : "/login"}>{aviso && modo === "definir" ? "Continuar" : "Voltar para entrar"}</Link>
      </section>
    </main>
  );
}
