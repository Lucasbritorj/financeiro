"use client";

// Barra de seleção em massa. Os controles de lote só aparecem quando há algo
// selecionado — sem seleção, é só a caixa de marcar tudo.

export function BarraSelecao({
  total,
  selecionadas,
  excluindoLote,
  onSelecionarTodas,
  onExcluirSelecionadas,
}: {
  total: number;
  selecionadas: number;
  excluindoLote: boolean;
  onSelecionarTodas: (marcar: boolean) => void;
  onExcluirSelecionadas: () => void;
}) {
  return (
    <div
      className="flex flex-wrap items-center gap-x-4 gap-y-2 px-1 text-sm"
      style={{ color: "var(--grafite)" }}
    >
      <label className="inline-flex cursor-pointer items-center gap-2">
        <input
          type="checkbox"
          checked={total > 0 && selecionadas === total}
          onChange={(e) => onSelecionarTodas(e.target.checked)}
          aria-label="Selecionar todas as transações carregadas"
        />
        Selecionar todas ({total})
      </label>
      {selecionadas > 0 && (
        <>
          <span style={{ color: "var(--giz)" }}>{selecionadas} selecionada(s)</span>
          <button
            type="button"
            onClick={onExcluirSelecionadas}
            disabled={excluindoLote}
            className="botao-fantasma botao-perigo text-xs"
          >
            {excluindoLote ? "Excluindo..." : "Excluir selecionadas"}
          </button>
          <button
            type="button"
            onClick={() => onSelecionarTodas(false)}
            className="text-xs underline-offset-2 hover:underline"
          >
            limpar
          </button>
        </>
      )}
    </div>
  );
}
