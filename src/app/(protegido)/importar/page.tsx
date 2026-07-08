import { createClient } from "@/lib/supabase/server";
import ImportadorCsv from "@/components/importador-csv";

export default async function ImportarPage() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("categorias")
    .select("id, nome, tipo")
    .order("nome");
  if (error) throw new Error(error.message);

  return (
    <div className="grid gap-6">
      <div className="grid gap-1">
        <h1 className="serifa text-2xl font-medium">Importar extrato</h1>
        <p className="text-sm" style={{ color: "var(--grafite)" }}>
          Suba o CSV do seu banco. As despesas já vêm categorizadas pelas suas
          regras; você revisa, remove duplicadas e confirma — tudo num lote só.
        </p>
      </div>
      <ImportadorCsv categorias={data} />
    </div>
  );
}
