"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { formatarCentavos, paraCentavos } from "@/lib/money";
import { mensagemDeErro } from "@/lib/erros";
import BotaoAcaoRpc from "@/components/botao-acao-rpc";
import {
  progressoPct,
  ritmoNecessario,
  statusCofrinho,
  dataProjetada,
  type CofrinhoProjecao,
  type MovimentacaoCofrinho,
  type StatusCofrinho,
} from "@/lib/cofrinhos";

const CIRCUNFERENCIA = 2 * Math.PI * 30;

const ROTULO_STATUS: Record<StatusCofrinho, { texto: string; cor: string }> = {
  no_ritmo: { texto: "no ritmo", cor: "var(--verde)" },
  adiantado: { texto: "adiantado", cor: "var(--verde)" },
  atrasado: { texto: "atrasado", cor: "var(--telha)" },
  completo: { texto: "concluído", cor: "var(--ouro)" },
  sem_meta: { texto: "sem prazo", cor: "var(--grafite)" },
};

function mesLegivel(mesISO: string | null): string | null {
  if (!mesISO) return null;
  const nomes = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
  return `${nomes[Number(mesISO.slice(5, 7)) - 1]}/${mesISO.slice(2, 4)}`;
}

export default function CofrinhoCard({
  cofrinho,
  movimentacoes,
  hojeISO,
}: {
  cofrinho: {
    id: string;
    nome: string;
    cor: string | null;
    valor_alvo: number;
    saldo_atual: number;
    data_alvo: string | null;
    horizonte: string;
  };
  movimentacoes: MovimentacaoCofrinho[];
  hojeISO: string;
}) {
  const router = useRouter();
  const [valor, setValor] = useState("");
  const [modo, setModo] = useState<"APORTE" | "RESGATE">("APORTE");
  const [pendente, setPendente] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const proj: CofrinhoProjecao = {
    valor_alvo: cofrinho.valor_alvo,
    saldo_atual: cofrinho.saldo_atual,
    data_alvo: cofrinho.data_alvo,
  };
  const pct = progressoPct(proj);
  const status = statusCofrinho(proj, movimentacoes, hojeISO);
  const necessario = ritmoNecessario(proj, hojeISO);
  const projetada = dataProjetada(proj, movimentacoes, hojeISO);
  const cor = cofrinho.cor ?? "var(--ouro)";
  const rot = ROTULO_STATUS[status];

  async function movimentar(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);
    const centavos = paraCentavos(valor);
    if (!Number.isFinite(centavos)) {
      setErro("Valor inválido.");
      return;
    }
    setPendente(true);
    const rpc = modo === "APORTE" ? "aportar_cofrinho" : "resgatar_cofrinho";
    const { error } = await createClient().rpc(rpc, {
      p_cofrinho_id: cofrinho.id,
      p_valor: centavos,
    });
    setPendente(false);
    if (error) {
      setErro(mensagemDeErro(error));
      return;
    }
    setValor("");
    router.refresh();
  }

  return (
    <div className="vidro-soberano grid gap-4 p-5">
      <div className="flex items-center gap-4">
        <div className="relative h-[74px] w-[74px] flex-none">
          <svg viewBox="0 0 74 74" width="74" height="74" aria-label={`Progresso ${pct}%`}>
            <g transform="rotate(-90 37 37)" fill="none" strokeWidth="7">
              <circle cx="37" cy="37" r="30" stroke="var(--pergaminho-2)" />
              <circle
                cx="37"
                cy="37"
                r="30"
                stroke={cor}
                strokeLinecap="round"
                strokeDasharray={`${(pct / 100) * CIRCUNFERENCIA} ${CIRCUNFERENCIA}`}
              />
            </g>
          </svg>
          <span className="numero-soberano absolute inset-0 grid place-content-center text-sm">
            {pct}%
          </span>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-medium">{cofrinho.nome}</span>
            <span
              className="selo"
              style={{ background: "var(--pergaminho-2)", color: "var(--grafite)" }}
            >
              {cofrinho.horizonte.toLowerCase()}
            </span>
          </div>
          <p className="numero-soberano mt-1 text-sm" style={{ color: "var(--grafite)" }}>
            <span style={{ color: "var(--giz)" }}>{formatarCentavos(cofrinho.saldo_atual)}</span>
            {" de "}
            <span style={{ color: "var(--giz)" }}>{formatarCentavos(cofrinho.valor_alvo)}</span>
          </p>
        </div>
        <div className="text-right text-sm">
          <span style={{ color: rot.cor }}>{rot.texto}</span>
          <span className="block text-xs" style={{ color: "var(--grafite)" }}>
            {status === "completo"
              ? "meta atingida"
              : necessario != null && necessario > 0
                ? `precisa ${formatarCentavos(necessario)}/mês`
                : projetada
                  ? `~${mesLegivel(projetada)}`
                  : "defina um aporte"}
          </span>
        </div>
      </div>

      <form onSubmit={movimentar} className="flex flex-wrap items-center gap-2">
        <select
          value={modo}
          onChange={(e) => setModo(e.target.value as "APORTE" | "RESGATE")}
          className="campo-soberano !mt-0 !w-auto py-1 text-sm"
          aria-label="Tipo de movimentação"
        >
          <option value="APORTE">Aportar</option>
          <option value="RESGATE">Resgatar</option>
        </select>
        <input
          value={valor}
          onChange={(e) => setValor(e.target.value)}
          inputMode="decimal"
          placeholder="R$ 0,00"
          className="campo-soberano !mt-0 !w-28 text-sm"
          aria-label="Valor da movimentação"
        />
        <button type="submit" disabled={pendente} className="botao-fantasma text-sm">
          {pendente ? "..." : "Confirmar"}
        </button>
        {erro && (
          <span className="text-xs" style={{ color: "var(--telha)" }}>
            {erro}
          </span>
        )}

        {/*
          Exclusão à direita, separada do fluxo de movimentar. O rótulo muda
          com o saldo em vez de deixar o usuário descobrir o FW409 no erro:
          com dinheiro guardado, o botão já diz que vai resgatar, e a
          confirmação mostra quanto. Sem saldo, é só excluir.
        */}
        <span className="ml-auto">
          {cofrinho.saldo_atual > 0 ? (
            <BotaoAcaoRpc
              acao={{
                rpc: "excluir_cofrinho",
                args: { p_cofrinho_id: cofrinho.id, p_resgatar_saldo: true },
              }}
              rotulo="Resgatar e excluir"
              rotuloPendente="Excluindo..."
              tituloConfirmacao={`Excluir "${cofrinho.nome}"`}
              confirmacao={`Este cofrinho tem ${formatarCentavos(
                cofrinho.saldo_atual,
              )} guardados. O valor será resgatado e registrado no histórico, e o cofrinho sai da lista. Nada é apagado do banco.`}
              sucesso={`"${cofrinho.nome}" excluído — ${formatarCentavos(
                cofrinho.saldo_atual,
              )} resgatados.`}
              perigo
            />
          ) : (
            <BotaoAcaoRpc
              acao={{ rpc: "excluir_cofrinho", args: { p_cofrinho_id: cofrinho.id } }}
              rotulo="Excluir"
              rotuloPendente="Excluindo..."
              tituloConfirmacao={`Excluir "${cofrinho.nome}"`}
              confirmacao={`O cofrinho sai da lista e dos totais. O histórico de aportes fica guardado no banco, não é apagado.`}
              sucesso={`"${cofrinho.nome}" excluído.`}
              perigo
            />
          )}
        </span>
      </form>
    </div>
  );
}
