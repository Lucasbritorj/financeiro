"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useConfirm, useToast } from "@/components/feedback";
import type {
  PeriodicidadeAssinatura,
  StatusAssinatura,
} from "@/lib/assinaturas";
import { mensagemDeErro } from "@/lib/erros";
import { centavosParaDecimalEditavel, paraCentavos } from "@/lib/money";
import { createClient } from "@/lib/supabase/client";

export type CategoriaOpcao = { id: string; nome: string; tipo: string };
export type CartaoOpcao = { id: string; nome: string };

export type AssinaturaLinha = {
  id: string;
  descricao: string;
  valor: number;
  categoria_id: string | null;
  cartao_id: string | null;
  periodicidade: PeriodicidadeAssinatura;
  proxima_data: string;
  status: StatusAssinatura;
};

export type FormAssinatura = {
  nome: string;
  valor: string;
  periodicidade: PeriodicidadeAssinatura;
  proximaCobranca: string;
  categoriaId: string;
  cartaoId: string;
};

const FORM_VAZIO: FormAssinatura = {
  nome: "",
  valor: "",
  periodicidade: "MENSAL",
  proximaCobranca: "",
  categoriaId: "",
  cartaoId: "",
};

const COLUNAS =
  "id, descricao, valor, categoria_id, cartao_id, periodicidade, proxima_data, status";

// Cada passagem de aplicar_recorrencias avança no máximo 12 ciclos e sinaliza
// pendentes. O teto só impede loop se o motor não convergir; não recalcula data.
const PASSAGENS_MOTOR = 24;

export function useCentralAssinaturas() {
  const notificar = useToast();
  const confirmar = useConfirm();
  const [assinaturas, setAssinaturas] = useState<AssinaturaLinha[] | null>(null);
  const [indisponivel, setIndisponivel] = useState(false);
  const [formAberto, setFormAberto] = useState(false);
  const [editandoId, setEditandoId] = useState<string | null>(null);
  const [pendente, setPendente] = useState(false);
  const [form, setForm] = useState<FormAssinatura>(FORM_VAZIO);

  const carregar = useCallback(() => {
    return createClient()
      .from("recorrencias")
      .select(COLUNAS)
      .eq("finalidade", "ASSINATURA")
      .order("proxima_data")
      .then(({ data, error }) => {
        if (error) {
          setIndisponivel(true);
          return;
        }
        setIndisponivel(false);
        setAssinaturas(data as AssinaturaLinha[]);
      });
  }, []);

  const sincronizar = useCallback(() => {
    const supabase = createClient();
    const executar = async () => {
      for (let passagem = 0; passagem < PASSAGENS_MOTOR; passagem++) {
        const { data, error } = await supabase.rpc("aplicar_recorrencias");
        if (error) {
          if (error.code === "PGRST202") {
            setIndisponivel(true);
            return;
          }
          notificar(`Recorrências: ${mensagemDeErro(error)}`, "erro");
          break;
        }
        if (!(data as { pendentes?: boolean } | null)?.pendentes) break;
      }
      await carregar();
    };
    return executar();
  }, [carregar, notificar]);

  useEffect(() => {
    void sincronizar();
  }, [sincronizar]);

  function abrirNovo() {
    setForm(FORM_VAZIO);
    setEditandoId(null);
    setFormAberto(true);
  }

  function abrirEdicao(assinatura: AssinaturaLinha) {
    setForm({
      nome: assinatura.descricao,
      valor: centavosParaDecimalEditavel(assinatura.valor),
      periodicidade: assinatura.periodicidade,
      proximaCobranca: assinatura.proxima_data,
      categoriaId: assinatura.categoria_id ?? "",
      cartaoId: assinatura.cartao_id ?? "",
    });
    setEditandoId(assinatura.id);
    setFormAberto(true);
  }

  function fecharForm() {
    setFormAberto(false);
    setForm(FORM_VAZIO);
    setEditandoId(null);
  }

  async function salvar(evento: FormEvent) {
    evento.preventDefault();
    const centavos = paraCentavos(form.valor);
    if (!Number.isFinite(centavos)) {
      notificar("Valor inválido.", "erro");
      return;
    }

    setPendente(true);
    const parametros = {
      p_nome: form.nome.trim(),
      p_valor: centavos,
      p_periodicidade: form.periodicidade,
      p_proxima_cobranca: form.proximaCobranca,
      p_categoria_id: form.categoriaId || null,
      p_cartao_id: form.cartaoId || null,
    };
    const supabase = createClient();
    const { error } = editandoId
      ? await supabase.rpc("editar_assinatura", {
          p_assinatura_id: editandoId,
          ...parametros,
        })
      : await supabase.rpc("criar_assinatura", parametros);
    setPendente(false);

    if (error) {
      notificar(mensagemDeErro(error), "erro");
      return;
    }
    notificar(editandoId ? "Assinatura atualizada." : "Assinatura cadastrada.", "sucesso");
    fecharForm();
    void carregar();
  }

  async function alterarStatus(
    assinatura: AssinaturaLinha,
    status: StatusAssinatura,
  ) {
    if (status === "CANCELADA") {
      const confirmado = await confirmar({
        titulo: "Cancelar assinatura",
        mensagem:
          `Cancelar "${assinatura.descricao}"? ` +
          "Isto registra o cancelamento no Ateliê, mas não cancela junto ao fornecedor.",
        rotuloConfirmar: "Cancelar assinatura",
        perigo: true,
      });
      if (!confirmado) return;
    }

    const { error } = await createClient().rpc("alterar_status_assinatura", {
      p_assinatura_id: assinatura.id,
      p_status: status,
    });
    if (error) {
      notificar(mensagemDeErro(error), "erro");
      return;
    }

    const mensagens: Record<StatusAssinatura, string> = {
      ATIVA: "Assinatura reativada.",
      PAUSADA: "Assinatura pausada.",
      CANCELADA: "Assinatura cancelada no Ateliê.",
    };
    notificar(mensagens[status], "sucesso");
    void carregar();
  }

  return {
    assinaturas,
    indisponivel,
    formAberto,
    editandoId,
    pendente,
    form,
    setForm,
    abrirNovo,
    abrirEdicao,
    fecharForm,
    salvar,
    alterarStatus,
  };
}
