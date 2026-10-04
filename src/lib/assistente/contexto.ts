// Contexto que o assistente envia ao modelo — lógica pura, testada em
// tests/unit/assistente-contexto.test.ts.
//
// A REGRA QUE ESTE ARQUIVO EXISTE PARA CUMPRIR
//
// O modelo recebe **só agregados**: totais por categoria, saldo, projeção,
// histórico mensal. Nunca o razão bruto. Uma transação individual carrega
// descrição ("Consulta Dr. Silva", "Advogado Trabalhista", o nome de quem
// recebeu um Pix) e é dado sensível que não precisa sair daqui para o
// assistente responder "onde cortar R$ 200" — a resposta útil vem de
// "Delivery R$ 812 contra orçamento de R$ 350", não da lista de pedidos.
//
// Por isso `montarContexto` é a ÚNICA porta entre o banco e o prompt, e
// devolve um tipo que **não tem campo de texto livre vindo do usuário**.
// O teste companheiro serializa o contexto e falha se qualquer descrição
// de transação aparecer nele — a regra é enforcement, não comentário.
//
// Reusa as funções de insights.ts em vez de reagregar: elas já resolvem
// LIQUIDACAO_FATURA, orçamento estourado e projeção, e são testadas.
import { mesesAnteriores } from "../analise.ts";
import { mesCorrenteSaoPaulo } from "../dashboard-dados.ts";
import {
  gastoPorCategoria,
  historicoMensal,
  nomeMes,
  projecaoFechamento,
  resumoDoMes,
  taxaPoupanca,
  type TransacaoInsight,
} from "../insights.ts";

/** Uma categoria no contexto: nome e números, nunca lançamento individual. */
export type CategoriaContexto = {
  nome: string;
  gasto: number;
  orcamento: number | null;
  estourado: boolean;
};

export type MesContexto = {
  mes: string;
  mes_nome: string;
  entradas: number;
  saidas: number;
  saldo: number;
};

/**
 * O que trafega para o modelo. Todo campo é número, data ou nome de
 * categoria — nomes de categoria são criados pelo próprio usuário para
 * classificar, não descrevem um lançamento específico.
 */
export type ContextoAssistente = {
  mes_referencia: string;
  mes_nome: string;
  moeda: "BRL";
  unidade: "centavos";
  entradas: number;
  saidas: number;
  saldo: number;
  taxa_poupanca_pct: number | null;
  projecao_fechamento: number | null;
  categorias: CategoriaContexto[];
  historico: MesContexto[];
  total_transacoes_no_mes: number;
};

const MESES_HISTORICO = 6;

/**
 * Agrega as transações do mês em números. Único caminho entre o banco e o
 * prompt — se um dado não passa por aqui, ele não chega ao modelo.
 */
export function montarContexto(
  transacoes: readonly TransacaoInsight[],
  mesISO: string,
  hoje: Date = new Date(),
): ContextoAssistente {
  const lista = [...transacoes];
  const { entradas, saidas, saldo } = resumoDoMes(lista, mesISO);
  const categorias = gastoPorCategoria(lista, mesISO);
  const historicoBruto = historicoMensal(lista, mesesAnteriores(mesISO, MESES_HISTORICO));

  // A projeção só faz sentido para o mês corrente: num mês fechado o valor
  // real já é conhecido, e projetar "o ritmo até o dia X" de um mês passado
  // devolveria um número inventado com cara de previsão.
  //
  // Mês corrente e dia de hoje saem do fuso de negócio (America/Sao_Paulo), não
  // do fuso local do servidor: na Vercel em UTC, entre 21h e 24h de SP do último
  // dia do mês, o local já virou o mês seguinte e a projeção do mês corrente
  // sumiria (CLAUDE.md: cliente decide data por hojeSaoPaulo/mesCorrenteSaoPaulo,
  // nunca por new Date() local).
  const [ano, mes] = mesISO.split("-").map(Number);
  const mesCorrente = mesCorrenteSaoPaulo(hoje) === mesISO;
  const diaDeHoje = Number(
    new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" })
      .format(hoje)
      .slice(8, 10),
  );
  const diasNoMes = new Date(Date.UTC(ano, mes, 0)).getUTCDate();

  return {
    mes_referencia: mesISO,
    mes_nome: nomeMes(mesISO),
    moeda: "BRL",
    unidade: "centavos",
    entradas,
    saidas,
    saldo,
    taxa_poupanca_pct: taxaPoupanca(entradas, saidas),
    projecao_fechamento: mesCorrente
      ? projecaoFechamento(saidas, diaDeHoje, diasNoMes)
      : null,
    categorias: categorias.map((c) => ({
      nome: c.nome,
      gasto: c.gasto,
      orcamento: c.orcamento,
      estourado: c.orcamento !== null && c.gasto > c.orcamento,
    })),
    historico: historicoBruto.map((h) => ({
      mes: h.mes,
      mes_nome: nomeMes(h.mes),
      entradas: h.entradas,
      saidas: h.saidas,
      saldo: h.saldo,
    })),
    total_transacoes_no_mes: transacoes.filter((t) =>
      t.data_compra.startsWith(mesISO),
    ).length,
  };
}

/**
 * Prompt do sistema. Fica aqui, junto do contexto, porque as duas coisas
 * mudam juntas: instrução que promete um dado que o contexto não carrega
 * faz o modelo inventar.
 */
export const SISTEMA_ASSISTENTE = [
  "Você é o assistente financeiro de um app pessoal de finanças brasileiro.",
  "",
  "DADOS",
  "- Você recebe apenas AGREGADOS do mês: totais, gastos por categoria, orçamentos,",
  "  histórico mensal. Você NÃO tem acesso a transações individuais.",
  "- Todo valor está em CENTAVOS de real. 123456 = R$ 1.234,56. Sempre converta ao responder.",
  "- Se a pergunta exigir um lançamento específico ('quanto foi a compra da farmácia'),",
  "  diga que você só enxerga totais por categoria e sugira a tela de Transações.",
  "",
  "COMO RESPONDER",
  "- Português do Brasil, direto, sem preâmbulo. Duas a cinco frases na maioria dos casos.",
  "- Cite os números que sustentam o que você afirma.",
  "- Nunca invente um número que não esteja no contexto. Se o dado não está lá, diga isso.",
  "- Para 'onde cortar', use a distância entre gasto e orçamento e o tamanho da categoria.",
  "",
  "LIMITES",
  "- Você não é consultor de investimentos licenciado. Se pedirem recomendação de",
  "  investimento, diga isso em uma frase e siga com o que dá para dizer sobre o orçamento.",
  "- Não prometa ação que você não executa: você não cria, edita nem apaga lançamento.",
].join("\n");
