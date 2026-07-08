import { createClient } from "@/lib/supabase/server";
import NovaTransacaoForm from "@/components/nova-transacao-form";
import ListaTransacoes, { type TransacaoLista } from "@/components/lista-transacoes";
import { TAMANHO_PAGINA_TRANSACOES } from "@/lib/constantes";

const COLUNAS =
  "id, descricao, valor_total, tipo, forma_pagamento, data_compra, num_parcelas, created_at, categoria_id";

export default async function TransacoesPage() {
  const supabase = await createClient();

  // Primeira página por keyset (created_at, id) desc; pede N+1 para saber
  // se há próxima sem uma contagem separada.
  const [cartoesRes, categoriasRes, transacoesRes] = await Promise.all([
    supabase.from("cartoes_credito").select("id, nome").order("nome"),
    supabase.from("categorias").select("id, nome, tipo").order("nome"),
    supabase
      .from("transacoes_origem")
      .select(COLUNAS)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(TAMANHO_PAGINA_TRANSACOES + 1),
  ]);
  if (cartoesRes.error) throw new Error(cartoesRes.error.message);
  if (categoriasRes.error) throw new Error(categoriasRes.error.message);
  if (transacoesRes.error) throw new Error(transacoesRes.error.message);

  const todas = transacoesRes.data as TransacaoLista[];
  const temMais = todas.length > TAMANHO_PAGINA_TRANSACOES;
  const primeira = todas.slice(0, TAMANHO_PAGINA_TRANSACOES);

  return (
    <div className="grid gap-6">
      <h1 className="serifa text-2xl font-medium">Transações</h1>
      <NovaTransacaoForm cartoes={cartoesRes.data} categorias={categoriasRes.data} />
      <ListaTransacoes
        inicial={primeira}
        categorias={categoriasRes.data}
        temMais={temMais}
      />
    </div>
  );
}
