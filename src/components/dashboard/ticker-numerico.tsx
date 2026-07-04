"use client";

import { useEffect } from "react";
import { motion, useSpring, useTransform } from "framer-motion";
import { formatarCentavos } from "@/lib/money";

// Odômetro: o valor rola com física de mola até o dado novo do backend.
// Numerais tabulares (.numero-soberano) impedem o layout de "pular".
const MOLA = { stiffness: 300, damping: 30 };

export default function TickerNumerico({
  centavos,
  className,
}: {
  centavos: number;
  className?: string;
}) {
  const mola = useSpring(centavos, MOLA);
  useEffect(() => {
    mola.set(centavos);
  }, [centavos, mola]);
  const texto = useTransform(mola, (v) => formatarCentavos(Math.round(v)));

  return (
    <motion.span className={`numero-soberano ${className ?? ""}`}>{texto}</motion.span>
  );
}
