import ProviderConsulta from "@/components/dashboard/provider-consulta";
import PainelPatrimonio from "@/components/dashboard/painel-patrimonio";

export default function DashboardPage() {
  return (
    <div className="grid gap-6">
      <h1 className="text-xl font-semibold">Dashboard</h1>
      <ProviderConsulta>
        <PainelPatrimonio />
      </ProviderConsulta>
    </div>
  );
}
