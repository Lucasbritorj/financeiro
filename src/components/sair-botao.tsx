"use client";

import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function SairBotao() {
  const router = useRouter();

  async function sair() {
    await createClient().auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <button
      onClick={sair}
      className="rounded border border-zinc-300 px-2 py-1 text-xs hover:bg-zinc-100"
    >
      Sair
    </button>
  );
}
