"use client";

import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

export default function ProviderConsulta({ children }: { children: React.ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // Realtime invalida na mudança; o intervalo é rede de segurança
            // para projetos sem Realtime habilitado no painel.
            refetchInterval: 60_000,
            staleTime: 30_000,
          },
        },
      })
  );
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
