import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import NovaTransacaoForm from "@/components/nova-transacao-form";
import ListaTransacoes, { type TransacaoLista } from "@/components/lista-transacoes";
import Recorrencias from "@/components/recorrencias";
import { TAMANHO_PAGINA_TRANSACOES } from "@/lib/constantes";
import {
  aplicarFiltrosTransacoes,
  filtrosDaQuery,
  queryDosFiltros,
  temFiltro,
} from "@/lib/filtros-transacoes";
import { hojeSaoPaulo } from "@/lib/data";

// ATENÇÃO: existe uma cópia desta lista em components/lista-transacoes.tsx
// (o "carregar mais" do cliente). As duas precisam andar juntas — omitir uma
// coluna aqui faz a primeira página vir sem o campo e a segunda com ele.
const COLUNAS =
  "id, descricao, valor_total, tipo, forma_pagamento, data_compra, data_vencimento, num_parcelas, created_at, categoria_id, source, natureza";

function diasAtras(hoje: string, dias: number): string {
  const d = new Date(`${hoje}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - dias);
  return d.toISOString().slice(0, 10);
}

function mesesAtras(hoje: string, meses: number): string {
  const d = new Date(`${hoje}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() - meses);
  return d.toISOString().slice(0, 10);
}

export default async function TransacoesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const supabase = await createClient();
  const filtros = filtrosDaQuery(await searchParams);
  const hoje = hojeSaoPaulo();

  // Primeira página por keyset (created_at, id) desc; pede N+1 para saber
  // se há próxima sem uma contagem separada. Filtros valem aqui e no
  // "carregar mais" do cliente (mesmo helper).
  const consultaBase = supabase
    .from("transacoes_origem")
    .select(COLUNAS)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(TAMANHO_PAGINA_TRANSACOES + 1);

  const [cartoesRes, categoriasRes, transacoesRes] = await Promise.all([
    supabase.from("cartoes_credito").select("id, nome").order("nome"),
    supabase.from("categorias").select("id, nome, tipo").order("nome"),
    aplicarFiltrosTransacoes(consultaBase, filtros),
  ]);
  if (cartoesRes.error) throw new Error(cartoesRes.error.message);
  if (categoriasRes.error) throw new Error(categoriasRes.error.message);
  if (transacoesRes.error) throw new Error(transacoesRes.error.message);

  const todas = transacoesRes.data as TransacaoLista[];
  const temMais = todas.length > TAMANHO_PAGINA_TRANSACOES;
  const primeira = todas.slice(0, TAMANHO_PAGINA_TRANSACOES);

  // Períodos rápidos: preservam categoria/tipo/forma, trocam só as datas.
  const periodos = [
    { rotulo: "7 dias", de: diasAtras(hoje, 6) },
    { rotulo: "30 dias", de: diasAtras(hoje, 29) },
    { rotulo: "3 meses", de: mesesAtras(hoje, 3) },
    { rotulo: "1 ano", de: mesesAtras(hoje, 12) },
  ].map((p) => ({
    rotulo: p.rotulo,
    href: `/transacoes${queryDosFiltros({ ...filtros, de: p.de, ate: hoje })}`,
    ativo: filtros.de === p.de && filtros.ate === hoje,
  }));

  return (
    <div className="grid gap-6">
      <h1 className="serifa text-2xl font-medium">Transações</h1>
      <NovaTransacaoForm cartoes={cartoesRes.data} categorias={categoriasRes.data} />

      <Recorrencias categorias={categoriasRes.data} />

      {/* Barra de filtros: form GET puro — o servidor re-renderiza com a
          querystring; zero estado no cliente. */}
      <form
        method="get"
        className="vidro-soberano flex flex-wrap items-end gap-x-4 gap-y-3 p-4 text-sm"
      >
        <label>
          Categoria
          <select name="categoria" defaultValue={filtros.categoria ?? ""} className="campo-soberano !w-auto">
            <option value="">Todas</option>
            <option value="sem">Sem categoria</option>
            {categoriasRes.data.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nome}
              </option>
            ))}
          </select>
        </label>
        <label>
          Tipo
          <select name="tipo" defaultValue={filtros.tipo ?? ""} className="campo-soberano !w-auto">
            <option value="">Todos</option>
            <option value="DESPESA">Despesa</option>
            <option value="RECEITA">Receita</option>
          </select>
        </label>
        <label>
          Forma
          <select name="forma" defaultValue={filtros.forma ?? ""} className="campo-soberano !w-auto">
            <option value="">Todas</option>
            <option value="CREDITO">Crédito</option>
            <option value="DEBITO">Débito</option>
            <option value="PIX">Pix</option>
            <option value="DINHEIRO">Dinheiro</option>
            <option value="BOLETO">Boleto</option>
          </select>
        </label>
        <label>
          De
          <input type="date" name="de" defaultValue={filtros.de ?? ""} className="campo-soberano !w-auto" />
        </label>
        <label>
          Até
          <input type="date" name="ate" defaultValue={filtros.ate ?? ""} className="campo-soberano !w-auto" />
        </label>
        <button type="submit" className="botao-soberano text-sm">
          Filtrar
        </button>
        {temFiltro(filtros) && (
          <Link href="/transacoes" className="botao-fantasma text-sm">
            Limpar
          </Link>
        )}
        <span className="flex flex-wrap items-center gap-2 text-xs" style={{ color: "var(--grafite)" }}>
          {periodos.map((p) => (
            <Link
              key={p.rotulo}
              href={p.href}
              className="selo"
              style={p.ativo ? { borderColor: "var(--ouro)", color: "var(--giz)" } : undefined}
            >
              {p.rotulo}
            </Link>
          ))}
        </span>
      </form>

      <ListaTransacoes
        key={queryDosFiltros(filtros) || "sem-filtro"}
        inicial={primeira}
        categorias={categoriasRes.data}
        cartoes={cartoesRes.data}
        temMais={temMais}
        filtros={filtros}
      />
    </div>
  );
}
