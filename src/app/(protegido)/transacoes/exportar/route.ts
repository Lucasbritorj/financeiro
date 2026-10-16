import { createClient } from "@/lib/supabase/server";
import { aplicarFiltrosTransacoes, filtrosDaQuery } from "@/lib/filtros-transacoes";
import { lerTodasPaginas } from "@/lib/leitura-paginada";
import { exportarCsv } from "@/lib/exportacao-csv";

const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
export async function GET(request: Request) {
  try {
    const supabase = await createClient();
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) return Response.json({ erro: "Entre para exportar." }, { status: 401, headers });
    const filtros = filtrosDaQuery(Object.fromEntries(new URL(request.url).searchParams));
    const linhas = await lerTodasPaginas((cursor, tamanho) => {
      let consulta = aplicarFiltrosTransacoes(supabase
      .from("transacoes_origem")
      .select("id, descricao, valor_total, data_compra, tipo, forma_pagamento, natureza, categorias(nome)")
      .order("id")
      .limit(tamanho), filtros);
      if (cursor) consulta = consulta.gt("id", cursor);
      return consulta.abortSignal(AbortSignal.timeout(15000));
    });
    return new Response(exportarCsv(linhas), { headers: { ...headers,
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="transacoes.csv"',
    } });
  } catch {
    return Response.json({ erro: "Não foi possível exportar. Tente novamente ou selecione um período menor." }, { status: 503, headers });
  }
}
