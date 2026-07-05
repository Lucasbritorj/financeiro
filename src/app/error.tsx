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
    <main className="flex min-h-screen items-center justify-center bg-zinc-50 px-4 text-zinc-900">
      <div className="w-full max-w-sm rounded-lg border border-zinc-200 bg-white p-6 text-center">
        <h1 className="text-lg font-semibold">Algo deu errado</h1>
        <p className="mt-2 text-sm text-zinc-500">
          Tente novamente. Se persistir, informe o código
          {error.digest ? ` ${error.digest}` : " exibido no console"} ao suporte.
        </p>
        <button
          onClick={reset}
          className="mt-4 rounded bg-zinc-900 px-4 py-2 text-sm text-white hover:bg-zinc-700"
        >
          Tentar novamente
        </button>
      </div>
    </main>
  );
}
