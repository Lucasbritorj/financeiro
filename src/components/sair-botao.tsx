"use client";

import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {useState} from 'react';

export default function SairBotao() {
  const router = useRouter();
  const [pendente,setPendente]=useState(false);
  const [erro,setErro]=useState(false);

  // Apaga TODOS os caches, não só o do service worker: no logout não há nada
  // guardado que valha manter, e varrer por nome acoplaria este componente à
  // constante do sw-rotas.js. Roda antes do redirect e nunca derruba a saída —
  // Cache Storage falta em contexto inseguro e lança em navegador com dados de
  // site bloqueados; o usuário precisa sair de qualquer jeito.
  async function limparCaches() {
    try {
      if (typeof caches === "undefined") return;
      const nomes = await caches.keys();
      await Promise.all(nomes.map((n) => caches.delete(n)));
    } catch {
      // sem cache para limpar, ou acesso negado: seguir com o logout
    }
  }

  async function sair() {
    if(pendente)return;
    setPendente(true);setErro(false);
    try{
      const {error}=await createClient().auth.signOut();
      if(error)throw error;
      await limparCaches();
      router.push("/login");router.refresh();
    }catch{setErro(true);}
    finally{setPendente(false);}
  }

  return (
    <><button
      onClick={sair}
      disabled={pendente}
      className="botao-fantasma text-xs"
    >
      {pendente?'Saindo…':'Sair'}
    </button>{erro&&<span role="alert" className="text-sm" style={{color:'var(--telha)'}}>Não foi possível sair. Tente novamente.</span>}</>
  );
}
