"use client";

// Camada de feedback da UI: toasts discretos (substituem os <p> inline de
// sucesso/erro) e um diálogo de confirmação acessível com <dialog> nativo
// (substitui window.confirm — foco preso, Esc, backdrop, aria-modal de graça).
// Um provider só, dois contextos, montado uma vez no layout protegido.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";

// ----------------------------- Toasts -----------------------------
type ToastTipo = "sucesso" | "erro" | "info";
type Toast = { id: number; mensagem: string; tipo: ToastTipo };

const ToastContext = createContext<((mensagem: string, tipo?: ToastTipo) => void) | null>(null);

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast precisa do <FeedbackProvider>.");
  return ctx;
}

// ------------------------- Confirmação --------------------------
type ConfirmOpts = {
  mensagem: string;
  titulo?: string;
  rotuloConfirmar?: string;
  rotuloCancelar?: string;
  perigo?: boolean;
};
const ConfirmContext = createContext<((opts: ConfirmOpts) => Promise<boolean>) | null>(null);

export function useConfirm() {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error("useConfirm precisa do <FeedbackProvider>.");
  return ctx;
}

const DURACAO_MS = 4200;

export default function FeedbackProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const proximoId = useRef(1);

  const notificar = useCallback((mensagem: string, tipo: ToastTipo = "info") => {
    const id = proximoId.current++;
    setToasts((atual) => [...atual, { id, mensagem, tipo }]);
    setTimeout(() => setToasts((atual) => atual.filter((t) => t.id !== id)), DURACAO_MS);
  }, []);

  // Diálogo de confirmação: uma instância de <dialog>, a promessa em aberto
  // resolve no fechamento (confirmar => true, o resto => false).
  const dialogRef = useRef<HTMLDialogElement>(null);
  const resolverRef = useRef<((v: boolean) => void) | null>(null);
  const [opts, setOpts] = useState<ConfirmOpts | null>(null);

  const confirmar = useCallback((o: ConfirmOpts) => {
    setOpts(o);
    return new Promise<boolean>((resolve) => {
      resolverRef.current = resolve;
    });
  }, []);

  useEffect(() => {
    if (opts && dialogRef.current && !dialogRef.current.open) {
      dialogRef.current.showModal();
    }
  }, [opts]);

  function fechar(confirmado: boolean) {
    resolverRef.current?.(confirmado);
    resolverRef.current = null;
    dialogRef.current?.close();
    setOpts(null);
  }

  return (
    <ToastContext.Provider value={notificar}>
      <ConfirmContext.Provider value={confirmar}>
        {children}

        {/* Pilha de toasts: polido, não bloqueia. aria-live anuncia sem roubar foco. */}
        <div className="toast-pilha" aria-live="polite" aria-atomic="false">
          {toasts.map((t) => (
            <div
              key={t.id}
              className={`toast toast-${t.tipo}`}
              role={t.tipo === "erro" ? "alert" : "status"}
            >
              {t.mensagem}
            </div>
          ))}
        </div>

        <dialog
          ref={dialogRef}
          className="dialogo"
          onCancel={(e) => {
            e.preventDefault();
            fechar(false);
          }}
          aria-labelledby="dialogo-titulo"
        >
          {opts && (
            <div className="grid gap-4">
              <div className="grid gap-1">
                <h2 id="dialogo-titulo" className="serifa text-lg font-medium">
                  {opts.titulo ?? "Confirmar"}
                </h2>
                <p className="text-sm" style={{ color: "var(--grafite)" }}>
                  {opts.mensagem}
                </p>
              </div>
              <div className="flex justify-end gap-3">
                <button
                  type="button"
                  className="botao-fantasma text-sm"
                  onClick={() => fechar(false)}
                >
                  {opts.rotuloCancelar ?? "Cancelar"}
                </button>
                <button
                  type="button"
                  autoFocus
                  className={
                    opts.perigo
                      ? "botao-fantasma botao-perigo text-sm"
                      : "botao-soberano text-sm"
                  }
                  onClick={() => fechar(true)}
                >
                  {opts.rotuloConfirmar ?? "Confirmar"}
                </button>
              </div>
            </div>
          )}
        </dialog>
      </ConfirmContext.Provider>
    </ToastContext.Provider>
  );
}
