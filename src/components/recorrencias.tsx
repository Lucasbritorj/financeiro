"use client";

// Recorrências (0015): "aluguel todo dia 5", "salário dia 1". A regra vive
// no banco; a materialização acontece via aplicar_recorrencias() — disparada
// ao abrir o dashboard (AplicadorRecorrencias) — e vira transação comum.
// Componente autossuficiente: busca a própria lista e, se a migration ainda
// não foi aplicada (tabela/RPC ausente), avisa em vez de quebrar a página.

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { formatarCentavos, paraCentavos } from "@/lib/money";
import { mensagemDeErro } from "@/lib/erros";
import { useToast, useConfirm } from "@/components/feedback";

type CategoriaOpcao = { id: string; nome: string; tipo: string };

type RecorrenciaLinha = {
  id: string;
  descricao: string;
  valor: number;
  tipo: string;
  forma_pagamento: string;
  categoria_id: string | null;
  dia_do_mes: number;
  proxima_data: string;
  ativa: boolean;
};

export default function Recorrencias({ categorias }: { categorias: CategoriaOpcao[] }) {
  const router = useRouter();
  const notificar = useToast();
  const confirmar = useConfirm();
  const [linhas, setLinhas] = useState<RecorrenciaLinha[] | null>(null);
  const [indisponivel, setIndisponivel] = useState(false);
  const [formAberto, setFormAberto] = useState(false);

  const [descricao, setDescricao] = useState("");
  const [valor, setValor] = useState("");
  const [tipo, setTipo] = useState("DESPESA");
  const [forma, setForma] = useState("PIX");
  const [dia, setDia] = useState("5");
  const [categoriaId, setCategoriaId] = useState("");
  const [pendente, setPendente] = useState(false);

  // Sem async/await de propósito: setState só dentro do .then satisfaz a
  // regra set-state-in-effect do React Compiler (mesmo padrão do aplicador).
  const carregar = useCallback(() => {
    return createClient()
      .from("recorrencias")
      .select("id, descricao, valor, tipo, forma_pagamento, categoria_id, dia_do_mes, proxima_data, ativa")
      .order("dia_do_mes")
      .then(({ data, error }) => {
        if (error) {
          // Tabela ainda não existe (migration 0015 pendente): aviso, não crash.
          setIndisponivel(true);
          return;
        }
        setLinhas(data as RecorrenciaLinha[]);
      });
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  async function criar(e: React.FormEvent) {
    e.preventDefault();
    const centavos = paraCentavos(valor);
    if (!Number.isFinite(centavos)) {
      notificar("Valor inválido.", "erro");
      return;
    }
    setPendente(true);
    const { error } = await createClient().rpc("criar_recorrencia", {
      p_descricao: descricao.trim(),
      p_valor: centavos,
      p_tipo: tipo,
      p_forma_pagamento: forma,
      p_dia_do_mes: Number(dia),
      p_categoria_id: categoriaId || null,
    });
    setPendente(false);
    if (error) {
      notificar(mensagemDeErro(error), "erro");
      return;
    }
    notificar(`Recorrência criada: ${descricao.trim()} todo dia ${dia}.`, "sucesso");
    setDescricao("");
    setValor("");
    setFormAberto(false);
    void carregar();
    router.refresh();
  }

  async function alternar(r: RecorrenciaLinha) {
    const { error } = await createClient().rpc("alternar_recorrencia", {
      p_recorrencia_id: r.id,
      p_ativa: !r.ativa,
    });
    if (error) {
      notificar(mensagemDeErro(error), "erro");
      return;
    }
    notificar(r.ativa ? "Recorrência pausada." : "Recorrência reativada.", "sucesso");
    void carregar();
  }

  async function excluir(r: RecorrenciaLinha) {
    const ok = await confirmar({
      titulo: "Excluir recorrência",
      mensagem: `Excluir "${r.descricao}"? Os lançamentos já criados permanecem.`,
      rotuloConfirmar: "Excluir",
      perigo: true,
    });
    if (!ok) return;
    const { error } = await createClient().rpc("excluir_recorrencia", { p_recorrencia_id: r.id });
    if (error) {
      notificar(mensagemDeErro(error), "erro");
      return;
    }
    notificar("Recorrência excluída.", "sucesso");
    void carregar();
  }

  const categoriasDoTipo = categorias.filter((c) => c.tipo === tipo);
  const nomeCategoria = (id: string | null) =>
    id ? (categorias.find((c) => c.id === id)?.nome ?? "—") : "automática";

  return (
    <section className="vidro-soberano grid gap-3 p-4">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-medium">Recorrências</h2>
        <span className="text-xs" style={{ color: "var(--grafite)" }}>
          lançadas sozinhas todo mês, no dia marcado, ao abrir o app
        </span>
      </header>

      {indisponivel && (
        <p className="text-sm" style={{ color: "var(--ouro)" }}>
          Recorrências indisponíveis: aplique a migration 0015
          (supabase/APLICAR_0015_0016.sql) no SQL Editor do Supabase.
        </p>
      )}

      {linhas && linhas.length > 0 && (
        <ul className="grid gap-2">
          {linhas.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
              <span className="font-medium" style={{ opacity: r.ativa ? 1 : 0.5 }}>
                {r.descricao}
              </span>
              <span className="numero-soberano" style={{ color: r.tipo === "RECEITA" ? "var(--verde)" : "var(--giz)" }}>
                {r.tipo === "RECEITA" ? "+" : "-"}
                {formatarCentavos(r.valor)}
              </span>
              <span className="text-xs" style={{ color: "var(--grafite)" }}>
                todo dia {r.dia_do_mes} · {r.forma_pagamento} · {nomeCategoria(r.categoria_id)}
                {!r.ativa && " · pausada"}
              </span>
              <span className="ml-auto flex gap-2">
                <button type="button" className="botao-fantasma text-xs" onClick={() => alternar(r)}>
                  {r.ativa ? "Pausar" : "Reativar"}
                </button>
                <button
                  type="button"
                  className="botao-fantasma botao-perigo text-xs"
                  onClick={() => excluir(r)}
                >
                  Excluir
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
      {linhas && linhas.length === 0 && !formAberto && (
        <p className="text-sm" style={{ color: "var(--grafite)" }}>
          Nenhuma recorrência. Aluguel, assinatura no Pix, salário — cadastre uma
          vez e o lançamento entra sozinho todo mês.
        </p>
      )}

      {!formAberto ? (
        !indisponivel && (
          <button
            type="button"
            className="botao-fantasma justify-self-start text-sm"
            onClick={() => setFormAberto(true)}
          >
            Nova recorrência
          </button>
        )
      ) : (
        <form onSubmit={criar} className="grid gap-3">
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="text-sm sm:col-span-2">
              Descrição
              <input
                value={descricao}
                onChange={(e) => setDescricao(e.target.value)}
                required
                className="campo-soberano"
                placeholder="Ex.: Aluguel"
              />
            </label>
            <label className="text-sm">
              Valor (R$)
              <input
                value={valor}
                onChange={(e) => setValor(e.target.value)}
                required
                inputMode="decimal"
                className="campo-soberano"
                placeholder="1500,00"
              />
            </label>
            <label className="text-sm">
              Tipo
              <select value={tipo} onChange={(e) => setTipo(e.target.value)} className="campo-soberano">
                <option value="DESPESA">Despesa</option>
                <option value="RECEITA">Receita</option>
              </select>
            </label>
            <label className="text-sm">
              Forma (à vista)
              <select value={forma} onChange={(e) => setForma(e.target.value)} className="campo-soberano">
                <option value="PIX">Pix</option>
                <option value="DEBITO">Débito</option>
                <option value="DINHEIRO">Dinheiro</option>
              </select>
            </label>
            <label className="text-sm">
              Todo dia
              <input
                type="number"
                min={1}
                max={28}
                value={dia}
                onChange={(e) => setDia(e.target.value)}
                required
                className="campo-soberano"
              />
            </label>
            {categoriasDoTipo.length > 0 && (
              <label className="text-sm">
                Categoria
                <select
                  value={categoriaId}
                  onChange={(e) => setCategoriaId(e.target.value)}
                  className="campo-soberano"
                >
                  <option value="">Automática (por regra)</option>
                  {categoriasDoTipo.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.nome}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
          <p className="text-xs" style={{ color: "var(--grafite)" }}>
            Assinatura no cartão de crédito não entra aqui — ela já aparece na
            fatura. Boleto recorrente: use “duplicar” em Contas a pagar. Dia
            máximo 28 (existe em todo mês).
          </p>
          <div className="flex gap-3">
            <button type="submit" disabled={pendente} className="botao-soberano text-sm">
              {pendente ? "Criando..." : "Criar recorrência"}
            </button>
            <button type="button" className="botao-fantasma text-sm" onClick={() => setFormAberto(false)}>
              Cancelar
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
