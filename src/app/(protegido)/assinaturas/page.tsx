import CentralAssinaturas from "@/components/central-assinaturas";
import { createClient } from "@/lib/supabase/server";

export default async function AssinaturasPage() {
  const supabase = await createClient();
  const [categoriasRes, cartoesRes] = await Promise.all([
    supabase
      .from("categorias")
      .select("id, nome, tipo")
      .eq("tipo", "DESPESA")
      .order("nome"),
    supabase
      .from("cartoes_credito")
      .select("id, nome")
      .order("nome"),
  ]);

  if (categoriasRes.error) throw new Error(categoriasRes.error.message);
  if (cartoesRes.error) throw new Error(cartoesRes.error.message);

  return (
    <div className="grid gap-6">
      <header className="grid gap-1">
        <h1 className="serifa text-2xl font-medium">Central de Assinaturas</h1>
        <p className="text-sm" style={{ color: "var(--grafite)" }}>
          Acompanhe serviços contratados, próximas cobranças e o custo equivalente.
        </p>
      </header>
      <CentralAssinaturas
        categorias={categoriasRes.data}
        cartoes={cartoesRes.data}
      />
    </div>
  );
}
