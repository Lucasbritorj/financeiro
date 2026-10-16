"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { paraCentavos } from "@/lib/money";
import { mensagemDeErro } from "@/lib/erros";

type Tipo = "cartao" | "categoria" | "cofrinho" | "recorrencia";
type Campo = { chave: string; rotulo: string; tipo?: string; min?: number; max?: number; opcional?: boolean; opcoes?: [string, string][] };
const CAMPOS: Record<Tipo, Campo[]> = {
  cartao: [
    { chave: "nome", rotulo: "Nome" }, { chave: "limite_total", rotulo: "Limite (R$)", tipo: "dinheiro" },
    { chave: "dia_fechamento", rotulo: "Dia de fechamento", tipo: "number", min: 1, max: 31 },
    { chave: "dia_vencimento", rotulo: "Dia de vencimento", tipo: "number", min: 1, max: 31 },
  ],
  categoria: [
    { chave: "nome", rotulo: "Nome" }, { chave: "cor", rotulo: "Cor", tipo: "color" },
    { chave: "icone", rotulo: "Ícone", opcional: true },
  ],
  cofrinho: [
    { chave: "nome", rotulo: "Nome" }, { chave: "valor_alvo", rotulo: "Valor-alvo (R$)", tipo: "dinheiro" },
    { chave: "data_alvo", rotulo: "Data-alvo", tipo: "date", opcional: true },
    { chave: "horizonte", rotulo: "Horizonte", opcoes: [["CURTO", "Curto"], ["MEDIO", "Médio"], ["LONGO", "Longo"]] },
  ],
  recorrencia: [
    { chave: "descricao", rotulo: "Descrição" }, { chave: "valor", rotulo: "Valor (R$)", tipo: "dinheiro" },
    { chave: "tipo", rotulo: "Tipo", opcoes: [["DESPESA", "Despesa"], ["RECEITA", "Receita"]] },
    { chave: "forma_pagamento", rotulo: "Forma", opcoes: [["PIX", "Pix"], ["DEBITO", "Débito"], ["DINHEIRO", "Dinheiro"]] },
    { chave: "dia_do_mes", rotulo: "Todo dia", tipo: "number", min: 1, max: 28 },
  ],
};

export default function EditarCadastro({ tipo, id, valores, categorias = [], aoSalvar }: {
  tipo: Tipo; id: string; valores: Record<string, string>;
  categorias?: { id: string; nome: string; tipo: string }[];
  aoSalvar?: () => void | PromiseLike<unknown>;
}) {
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const [dados, setDados] = useState(valores);
  const [pendente, setPendente] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const enviando = useRef(false);

  function definir(chave: string, valor: string) {
    setDados((atual) => ({ ...atual, [chave]: valor, ...(chave === "tipo" ? { categoria_id: "" } : {}) }));
  }

  async function salvar(event: React.FormEvent) {
    event.preventDefault();
    if (enviando.current) return;
    setErro(null);
    const invalido = CAMPOS[tipo].find((campo) => campo.tipo === "dinheiro" && !Number.isSafeInteger(paraCentavos(dados[campo.chave])));
    if (invalido) {
      setErro(`${invalido.rotulo}: informe um valor positivo válido.`);
      return;
    }
    enviando.current = true;
    setPendente(true);
    try {
      const supabase = createClient();
      let resultado;
      switch (tipo) {
        case "cartao":
          resultado = await supabase.rpc("editar_cartao", { p_cartao_id: id, p_nome: dados.nome.trim(), p_limite_total: paraCentavos(dados.limite_total), p_dia_fechamento: Number(dados.dia_fechamento), p_dia_vencimento: Number(dados.dia_vencimento) });
          break;
        case "categoria":
          resultado = await supabase.rpc("editar_categoria", { p_categoria_id: id, p_nome: dados.nome.trim(), p_cor: dados.cor, p_icone: dados.icone });
          break;
        case "cofrinho":
          resultado = await supabase.rpc("editar_cofrinho", { p_cofrinho_id: id, p_nome: dados.nome.trim(), p_valor_alvo: paraCentavos(dados.valor_alvo), p_horizonte: dados.horizonte, p_data_alvo: dados.data_alvo || null });
          break;
        case "recorrencia":
          resultado = await supabase.rpc("editar_recorrencia", { p_recorrencia_id: id, p_descricao: dados.descricao.trim(), p_valor: paraCentavos(dados.valor), p_tipo: dados.tipo, p_forma_pagamento: dados.forma_pagamento, p_dia_do_mes: Number(dados.dia_do_mes), p_categoria_id: dados.categoria_id || null });
          break;
      }
      if (resultado.error) throw resultado.error;
      await aoSalvar?.();
      setAberto(false);
      setAviso("Alterações salvas.");
      router.refresh();
    } catch (error) {
      setErro(mensagemDeErro(error));
    } finally {
      enviando.current = false;
      setPendente(false);
    }
  }

  if (!aberto) return <div>
    <button type="button" className="botao-fantasma text-xs" onClick={() => { setDados(valores); setErro(null); setAviso(null); setAberto(true); }}>Editar</button>
    {aviso && <p role="status" className="text-xs">{aviso}</p>}
  </div>;

  return <form onSubmit={salvar} className="grid w-full gap-3 rounded-lg border p-3" style={{ borderColor: "var(--borda)" }} aria-label="Editar cadastro">
    <fieldset disabled={pendente} className="grid gap-3 sm:grid-cols-2">
      {CAMPOS[tipo].map((campo) => <label className="text-sm" key={campo.chave}>
        {campo.rotulo}
        {campo.opcoes ? <select className="campo-soberano" value={dados[campo.chave]} onChange={(e) => definir(campo.chave, e.target.value)}>
          {campo.opcoes.map(([valor, rotulo]) => <option key={valor} value={valor}>{rotulo}</option>)}
        </select> : <input className="campo-soberano" value={dados[campo.chave] ?? ""} onChange={(e) => definir(campo.chave, e.target.value)}
          type={campo.tipo === "dinheiro" ? "text" : campo.tipo ?? "text"} inputMode={campo.tipo === "dinheiro" ? "decimal" : undefined}
          min={campo.min} max={campo.max} maxLength={campo.chave === "descricao" ? 200 : campo.chave === "icone" ? 80 : 120} required={!campo.opcional} />}
      </label>)}
      {tipo === "recorrencia" && <label className="text-sm">Categoria
        <select className="campo-soberano" value={dados.categoria_id} onChange={(e) => definir("categoria_id", e.target.value)}>
          <option value="">Automática (por regra)</option>
          {categorias.filter((c) => c.tipo === dados.tipo).map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
        </select>
      </label>}
    </fieldset>
    {(tipo === "cartao" || tipo === "recorrencia") && <p className="text-xs">As alterações valem para próximas operações. O histórico já criado permanece.</p>}
    {erro && <p role="alert" className="text-sm" style={{ color: "var(--telha)" }}>{erro}</p>}
    <div className="flex gap-2">
      <button disabled={pendente} className="botao-soberano text-sm">{pendente ? "Salvando..." : "Salvar alterações"}</button>
      <button type="button" disabled={pendente} className="botao-fantasma text-sm" onClick={() => setAberto(false)}>Cancelar</button>
    </div>
  </form>;
}
