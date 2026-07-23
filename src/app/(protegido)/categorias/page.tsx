import { createClient } from "@/lib/supabase/server";
import NovaCategoriaForm from "@/components/nova-categoria-form";
import OrcamentoCategoria from "@/components/orcamento-categoria";
import BotaoAcaoRpc from "@/components/botao-acao-rpc";
import SemearCategorias from "@/components/semear-categorias";
import type { Categoria, RegraCategorizacao } from "@/lib/database.types";

export default async function CategoriasPage() {
  const supabase = await createClient();

  const [catRes, regrasRes] = await Promise.all([
    supabase
      .from("categorias")
      .select("id, nome, cor, icone, tipo, orcamento_mensal")
      .order("tipo")
      .order("nome"),
    supabase
      .from("regras_categorizacao")
      .select("id, padrao, categoria_id, prioridade")
      .order("prioridade"),
  ]);
  if (catRes.error) throw new Error(catRes.error.message);
  if (regrasRes.error) throw new Error(regrasRes.error.message);

  const categorias = catRes.data as Pick<
    Categoria,
    "id" | "nome" | "cor" | "icone" | "tipo" | "orcamento_mensal"
  >[];
  const regras = regrasRes.data as Pick<
    RegraCategorizacao,
    "id" | "padrao" | "categoria_id" | "prioridade"
  >[];
  const nomePorId = new Map(categorias.map((c) => [c.id, c.nome]));

  return (
    <div className="grid gap-6">
      <h1 className="serifa text-2xl font-medium">Categorias</h1>

      {categorias.length === 0 ? (
        <SemearCategorias />
      ) : (
        <section className="grid gap-2">
          {categorias.map((c) => (
            <div
              key={c.id}
              className="vidro-soberano flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3"
            >
              <span
                className="h-3 w-3 rounded-sm"
                style={{ background: c.cor ?? "var(--grafite)" }}
              />
              <span className="font-medium">{c.nome}</span>
              <span
                className="selo"
                style={{
                  background: "var(--pergaminho-2)",
                  color: "var(--grafite)",
                }}
              >
                {c.tipo}
              </span>
              {c.tipo === "DESPESA" && (
                <OrcamentoCategoria
                  categoriaId={c.id}
                  nome={c.nome}
                  orcamento={c.orcamento_mensal}
                />
              )}
              <span className="ml-auto">
                <BotaoAcaoRpc
                  acao={{ rpc: "excluir_categoria", args: { p_categoria_id: c.id } }}
                  rotulo="Excluir"
                  rotuloPendente="Excluindo..."
                  confirmacao={`Excluir "${c.nome}"? As transações mantêm o histórico; as regras desta categoria também saem.`}
                  perigo
                />
              </span>
            </div>
          ))}
        </section>
      )}

      <NovaCategoriaForm />

      {regras.length > 0 && (
        <section className="grid gap-3">
          <h2 className="serifa text-lg font-medium">Regras de categorização</h2>
          <p className="text-sm" style={{ color: "var(--grafite)" }}>
            Quando a descrição contém o padrão, a transação recebe a categoria
            automaticamente (menor prioridade vence). Cria-se uma regra ao
            recategorizar uma transação na tela de transações.
          </p>
          <div className="grid gap-2">
            {regras.map((r) => (
              <div
                key={r.id}
                className="vidro-soberano flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 text-sm"
              >
                <code
                  className="numero-soberano rounded px-2 py-0.5 text-xs"
                  style={{ background: "var(--pergaminho-2)" }}
                >
                  {r.padrao}
                </code>
                <span style={{ color: "var(--grafite)" }}>→</span>
                <span>{nomePorId.get(r.categoria_id) ?? "—"}</span>
                <span className="text-xs" style={{ color: "var(--grafite)" }}>
                  prioridade {r.prioridade}
                </span>
                <span className="ml-auto">
                  <BotaoAcaoRpc
                    acao={{ rpc: "excluir_regra_categorizacao", args: { p_regra_id: r.id } }}
                    rotulo="Remover"
                    rotuloPendente="Removendo..."
                    perigo
                  />
                </span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
