"use client";

// O rodapé é idêntico nos dois formulários: mensagem de erro e os dois botões.

export function RodapeEdicao({
  erro,
  pendente,
  aoFechar,
}: {
  erro: string | null;
  pendente: boolean;
  aoFechar: () => void;
}) {
  return (
    <>
      {erro && (
        <p className="text-sm" style={{ color: "var(--telha)" }}>
          {erro}
        </p>
      )}
      <div className="flex gap-3">
        <button type="submit" disabled={pendente} className="botao-soberano text-sm">
          {pendente ? "Salvando..." : "Salvar"}
        </button>
        <button type="button" onClick={aoFechar} className="botao-fantasma text-sm">
          Cancelar
        </button>
      </div>
    </>
  );
}
