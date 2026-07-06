"use client";

// Error boundary global: falha inesperada mostra mensagem neutra com o
// digest para suporte — nunca stack trace nem detalhe interno (A05).
export default function ErroGlobal({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="vidro-soberano w-full max-w-sm p-6 text-center">
        <h1 className="text-lg font-semibold">Algo deu errado</h1>
        <p className="mt-2 text-sm" style={{ color: "var(--texto-suave)" }}>
          Tente novamente. Se persistir, informe o código
          {error.digest ? ` ${error.digest}` : " exibido no console"} ao suporte.
        </p>
        <button
          onClick={reset}
          className="botao-soberano mt-4 text-sm"
        >
          Tentar novamente
        </button>
      </div>
    </main>
  );
}
