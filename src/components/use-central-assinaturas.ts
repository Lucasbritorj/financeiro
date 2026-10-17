"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { useConfirm, useToast } from "@/components/feedback";
import type {
  PeriodicidadeAssinatura,
  StatusAssinatura,
} from "@/lib/assinaturas";
import { mensagemDeErro } from "@/lib/erros";
import { centavosParaDecimalEditavel, paraCentavos } from "@/lib/money";
import { createClient } from "@/lib/supabase/client";
import { lerTodasPaginas } from "@/lib/leitura-paginada";

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
  const [erro, setErro] = useState<string | null>(null);
  const enviando = useRef(false);

  const carregar = useCallback(async () => {
    try {
      const supabase = createClient();
      const linhas = await lerTodasPaginas<AssinaturaLinha>((depois, tamanho) => {
        let consulta = supabase.from("recorrencias").select(COLUNAS).eq("finalidade", "ASSINATURA");
        if (depois) consulta = consulta.gt("id", depois);
        return consulta.order("id").limit(tamanho).then((resposta) => {
          if (resposta.error && ["42703", "42P01", "PGRST204"].includes(resposta.error.code)) setIndisponivel(true);
          return { data: resposta.data as AssinaturaLinha[] | null, error: resposta.error };
        });
      });
      setIndisponivel(false);
      setErro(null);
      setAssinaturas(linhas);
    } catch (error) {
      setErro(mensagemDeErro(error));
    }
  }, []);

  const sincronizar = useCallback(() => {
    const supabase = createClient();
    const executar = async () => {
      try {
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
          const resultado = data as { pendentes?: boolean; falhas?: unknown[] } | null;
          if (resultado?.falhas?.length) {
            notificar("Há recorrências que não puderam ser aplicadas. Confira os cadastros antes de tentar novamente.", "erro");
            break;
          }
          if (!resultado?.pendentes) break;
        }
      } catch (error) {
        notificar(mensagemDeErro(error), "erro");
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
    if (enviando.current) return;
    const centavos = paraCentavos(form.valor);
    if (!Number.isFinite(centavos)) {
      notificar("Valor inválido.", "erro");
      return;
    }

    enviando.current = true;
    setPendente(true);
    try {
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
      if (error) throw error;
      notificar(editandoId ? "Assinatura atualizada." : "Assinatura cadastrada.", "sucesso");
      fecharForm();
      await carregar();
    } catch (error) {
      notificar(mensagemDeErro(error), "erro");
    } finally {
      enviando.current = false;
      setPendente(false);
    }
  }

  async function alterarStatus(
    assinatura: AssinaturaLinha,
    status: StatusAssinatura,
  ) {
    if (enviando.current) return;
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

    if (enviando.current) return;
    enviando.current = true;
    setPendente(true);
    try {
      const { error } = await createClient().rpc("alterar_status_assinatura", {
        p_assinatura_id: assinatura.id,
        p_status: status,
      });
      if (error) throw error;

      const mensagens: Record<StatusAssinatura, string> = {
        ATIVA: "Assinatura reativada.",
        PAUSADA: "Assinatura pausada.",
        CANCELADA: "Assinatura cancelada no Ateliê.",
      };
      notificar(mensagens[status], "sucesso");
      await carregar();
    } catch (error) {
      notificar(mensagemDeErro(error), "erro");
    } finally {
      enviando.current = false;
      setPendente(false);
    }
  }

  return {
    assinaturas,
    indisponivel,
    erro,
    recarregar: sincronizar,
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
