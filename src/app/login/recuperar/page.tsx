import RecuperacaoSenha from "@/components/recuperacao-senha";
export default async function RecuperarPage({ searchParams }: {
  searchParams: Promise<{ erro?: string }>;
}) {
  const { erro } = await searchParams;
  return <RecuperacaoSenha modo="solicitar" erroInicial={erro ? "Link inválido ou expirado. Solicite outro link." : null} />;
}
