import { redirect } from "next/navigation";

export default function Home() {
  // O proxy redireciona para /login quando não autenticado.
  redirect("/transacoes");
}
