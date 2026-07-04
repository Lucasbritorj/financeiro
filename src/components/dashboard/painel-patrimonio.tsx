"use client";

import { useEffect, useMemo } from "react";
import { motion } from "framer-motion";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { agregarFluxoMensal, detectarAnomalia, type ParcelaFluxo } from "@/lib/fluxo";
import { formatarCentavos } from "@/lib/money";
import TickerNumerico from "./ticker-numerico";
import CartaoGlow from "./cartao-glow";
import GraficoFluxo from "./grafico-fluxo";
import PainelAnomalia from "./painel-anomalia";

const MOLA = { type: "spring" as const, stiffness: 300, damping: 30 };
const CHAVE_FLUXO = ["fluxo-caixa"];

async function buscarParcelas(): Promise<ParcelaFluxo[]> {
  const supabase = createClient();
  // RLS filtra usuário e soft-deletados; competência inclui parcelas
  // futuras do parcelamento (a curva projeta o comprometido).
  const { data, error } = await supabase
    .from("parcelas")
    .select("valor, data_competencia, transacoes_origem(tipo)")
    .order("data_competencia", { ascending: true });
  if (error) throw new Error(error.message);
  return data.flatMap((p) => {
    const tipo = p.transacoes_origem?.tipo;
    if (tipo !== "DESPESA" && tipo !== "RECEITA") return [];
    return [{ valor: p.valor, data_competencia: p.data_competencia, tipo }];
  });
}

export default function PainelPatrimonio() {
  const queryClient = useQueryClient();
  const { data: parcelas, isPending, error } = useQuery({
    queryKey: CHAVE_FLUXO,
    queryFn: buscarParcelas,
  });

  // Tempo real: mutação em parcelas invalida o cache na hora (exige
  // Realtime habilitado no painel; sem ele, vale o refetchInterval).
  useEffect(() => {
    const supabase = createClient();
    const canal = supabase
      .channel("fluxo-parcelas")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "parcelas" },
        () => queryClient.invalidateQueries({ queryKey: CHAVE_FLUXO })
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(canal);
    };
  }, [queryClient]);

  const pontos = useMemo(() => agregarFluxoMensal(parcelas ?? []), [parcelas]);
  const anomalia = useMemo(() => detectarAnomalia(pontos), [pontos]);
  const atual = pontos.at(-1);

  if (error) {
    return (
      <div className="soberano rounded-2xl p-6 overflow-hidden">
        <p className="text-sm" style={{ color: "var(--acento-negativo)" }}>
          Falha ao carregar o fluxo: {error.message}
        </p>
      </div>
    );
  }

  return (
    <div className="soberano rounded-2xl p-6 overflow-hidden">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={MOLA}
        className="grid gap-4"
      >
        <CartaoGlow className="p-6">
          <p className="text-xs uppercase tracking-widest" style={{ color: "var(--texto-suave)" }}>
            Posição líquida projetada
          </p>
          <div className="mt-1 text-4xl font-semibold">
            {isPending ? (
              <span className="numero-soberano" style={{ color: "var(--texto-suave)" }}>
                —
              </span>
            ) : (
              <TickerNumerico centavos={atual?.acumulado ?? 0} />
            )}
          </div>
          <div className="mt-4 grid grid-cols-2 gap-3 text-sm sm:max-w-md">
            <div>
              <p style={{ color: "var(--texto-suave)" }}>Entradas no mês</p>
              <p className="numero-soberano" style={{ color: "var(--acento)" }}>
                {formatarCentavos(atual?.entradas ?? 0)}
              </p>
            </div>
            <div>
              <p style={{ color: "var(--texto-suave)" }}>Saídas no mês</p>
              <p className="numero-soberano" style={{ color: "var(--acento-negativo)" }}>
                {formatarCentavos(atual?.saidas ?? 0)}
              </p>
            </div>
          </div>
        </CartaoGlow>

        <CartaoGlow className="p-4">
          <GraficoFluxo pontos={pontos} />
        </CartaoGlow>

        <PainelAnomalia anomalia={anomalia} />
      </motion.div>
    </div>
  );
}
