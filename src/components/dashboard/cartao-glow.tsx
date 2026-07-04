"use client";

import { useRef } from "react";

// Vidro escuro com iluminação radial que segue o cursor. O gradiente lê
// --mx/--my (CSS) setados aqui — sem re-render de React no mousemove.
export default function CartaoGlow({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);

  function aoMover(e: React.MouseEvent<HTMLDivElement>) {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    el.style.setProperty("--mx", `${e.clientX - r.left}px`);
    el.style.setProperty("--my", `${e.clientY - r.top}px`);
  }

  return (
    <div ref={ref} onMouseMove={aoMover} className={`vidro-soberano ${className ?? ""}`}>
      {children}
    </div>
  );
}
