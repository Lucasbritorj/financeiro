// Mensagem pós-registro de transação em NovaTransacaoForm — lógica pura,
// testada em tests/unit/nova-transacao.test.ts.
//
// A transação em si (processar_transacao_completa) é atômica: ou criou tudo,
// ou não criou nada. Mas quando o usuário escolhe a categoria à mão, isso é
// um passo SEPARADO (definir_categoria_transacao), pra não tocar na
// assinatura da RPC crítica de escrita — e esse passo pode falhar mesmo com
// a transação já criada. Mascarar isso como sucesso pleno é uma falha
// silenciosa: o usuário vê "sucesso" e a categoria não foi aplicada,
// distorcendo orçamento por categoria (T-05).

import { mensagemDeErro } from "./erros.ts";

type ErroComHint = { message: string; hint?: string | null };

export function mensagemPosTransacao(
  parcelasCriadas: number | undefined,
  erroCategoria: ErroComHint | null,
): { texto: string; tipo: "sucesso" | "erro" } {
  if (erroCategoria) {
    return {
      texto: `Transação registrada, mas a categoria não foi aplicada: ${mensagemDeErro(erroCategoria)}`,
      tipo: "erro",
    };
  }
  return {
    texto: `Transação registrada: ${parcelasCriadas ?? 1} parcela(s).`,
    tipo: "sucesso",
  };
}
