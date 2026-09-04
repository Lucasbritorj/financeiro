import { test, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TabelaRevisao, type CategoriaOpcao } from "@/components/importador-csv/tabela-revisao";
import type { LinhaRevisao } from "@/lib/importacao-preview";

// A tela de revisão é a última barreira antes de gravar transação: o que está
// marcado aqui vira lançamento no histórico do usuário. Saiu do refactor de
// importador-csv.tsx sem cobertura de render.

const CATEGORIAS: CategoriaOpcao[] = [
  { id: "mercado", nome: "Mercado", tipo: "DESPESA" },
  { id: "transporte", nome: "Transporte", tipo: "DESPESA" },
  { id: "salario", nome: "Salário", tipo: "RECEITA" },
];

function linha(over: Partial<LinhaRevisao> = {}): LinhaRevisao {
  return {
    id: "l1",
    data: "2026-07-09",
    valor: -4550,
    descricao: "PADARIA",
    categoria_sugerida: null,
    duplicada: false,
    ignorar: false,
    classificacao: "NOVO",
    ...over,
  };
}

function montar(over: Partial<Parameters<typeof TabelaRevisao>[0]> = {}) {
  const handlers = {
    onAlternarIgnorar: vi.fn(),
    onMudarCategoria: vi.fn(),
    onConfirmar: vi.fn(),
    onDescartar: vi.fn(),
  };
  render(
    <TabelaRevisao
      linhas={[linha()]}
      descartadasParse={0}
      categorias={CATEGORIAS}
      erro={null}
      pendente={false}
      {...handlers}
      {...over}
    />,
  );
  return handlers;
}

/** O texto corrido do resumo, para asserção sem depender da marcação. */
function textoDoResumo(): string {
  return screen.getByText(/linhas/).closest("div")!.textContent ?? "";
}

// ------------------------------- Resumo -------------------------------

test("resumo conta o total, as novas e quantas serão importadas", () => {
  montar({
    linhas: [
      linha({ id: "a", classificacao: "NOVO" }),
      linha({ id: "b", classificacao: "NOVO" }),
      linha({ id: "c", classificacao: "DUPLICADO" }),
    ],
  });
  expect(textoDoResumo()).toMatch(/3 linhas · 2 nova\(s\) · 2 serão importadas/);
});

test("resumo só menciona duplicadas, ambíguos e descartadas quando existem", () => {
  montar({ linhas: [linha()], descartadasParse: 0 });
  expect(screen.queryByText(/já existe/)).not.toBeInTheDocument();
  expect(screen.queryByText(/mesma data e valor/)).not.toBeInTheDocument();
  expect(screen.queryByText(/não reconhecida/)).not.toBeInTheDocument();
});

test("resumo anuncia duplicadas, ambíguos e linhas descartadas no parse", () => {
  montar({
    linhas: [
      linha({ id: "a", classificacao: "DUPLICADO" }),
      linha({ id: "b", classificacao: "AMBIGUO" }),
    ],
    descartadasParse: 4,
  });
  expect(screen.getByText(/já existe\(m\) no seu histórico/)).toBeInTheDocument();
  expect(screen.getByText(/mesma data e valor/)).toBeInTheDocument();
  expect(screen.getByText(/4 linha\(s\) do arquivo não reconhecida\(s\)/)).toBeInTheDocument();
});

// ------------------------------- Linhas -------------------------------

test("checkbox reflete o inverso de ignorar", () => {
  montar({
    linhas: [
      linha({ id: "a", descricao: "MARCADA", ignorar: false }),
      linha({ id: "b", descricao: "IGNORADA", ignorar: true }),
    ],
  });
  expect(screen.getByLabelText("Importar MARCADA")).toBeChecked();
  expect(screen.getByLabelText("Importar IGNORADA")).not.toBeChecked();
});

test("clicar no checkbox devolve a linha inteira ao chamador", async () => {
  const { onAlternarIgnorar } = montar({ linhas: [linha({ id: "x7", descricao: "PADARIA" })] });
  await userEvent.click(screen.getByLabelText("Importar PADARIA"));
  expect(onAlternarIgnorar).toHaveBeenCalledTimes(1);
  expect(onAlternarIgnorar.mock.calls[0][0].id).toBe("x7");
});

test("despesa mostra sinal negativo e receita mostra positivo", () => {
  montar({
    linhas: [
      linha({ id: "a", descricao: "GASTO", valor: -4550 }),
      linha({ id: "b", descricao: "ENTRADA", valor: 120000 }),
    ],
  });
  const celulas = screen.getAllByRole("cell").map((c) => c.textContent ?? "");
  expect(celulas.some((t) => t.startsWith("-"))).toBe(true);
  expect(celulas.some((t) => t.startsWith("+"))).toBe(true);
});

test("só despesa recebe seletor de categoria; receita é rotulada como tal", () => {
  montar({
    linhas: [
      linha({ id: "a", descricao: "GASTO", valor: -100 }),
      linha({ id: "b", descricao: "ENTRADA", valor: 100 }),
    ],
  });
  expect(screen.getByLabelText("Categoria de GASTO")).toBeInTheDocument();
  expect(screen.queryByLabelText("Categoria de ENTRADA")).not.toBeInTheDocument();
  expect(screen.getByText("receita")).toBeInTheDocument();
});

test("o seletor oferece só categorias de DESPESA", () => {
  montar({ linhas: [linha({ descricao: "GASTO" })] });
  const select = screen.getByLabelText("Categoria de GASTO");
  const opcoes = within(select).getAllByRole("option").map((o) => o.textContent);
  expect(opcoes).toEqual(["Sem categoria", "Mercado", "Transporte"]);
});

test("trocar a categoria devolve a linha e o id escolhido", async () => {
  const { onMudarCategoria } = montar({ linhas: [linha({ id: "z9", descricao: "GASTO" })] });
  await userEvent.selectOptions(screen.getByLabelText("Categoria de GASTO"), "transporte");
  expect(onMudarCategoria).toHaveBeenCalledWith(
    expect.objectContaining({ id: "z9" }),
    "transporte",
  );
});

test("limpar a categoria manda string vazia, não null", async () => {
  // O container distingue os dois: "" aciona p_limpar_categoria na RPC.
  const { onMudarCategoria } = montar({
    linhas: [linha({ descricao: "GASTO", categoria_sugerida: "mercado" })],
  });
  await userEvent.selectOptions(screen.getByLabelText("Categoria de GASTO"), "");
  expect(onMudarCategoria.mock.calls[0][1]).toBe("");
});

test("o badge de duplicada é independente da classificação", () => {
  // `duplicada` pinta o aviso; `classificacao` decide se grava. Os dois campos
  // são distintos e a tela não pode confundi-los.
  montar({
    linhas: [
      linha({ id: "a", descricao: "COM BADGE", duplicada: true, classificacao: "AMBIGUO" }),
      linha({ id: "b", descricao: "SEM BADGE", duplicada: false, classificacao: "AMBIGUO" }),
    ],
  });
  expect(screen.getAllByText("possível duplicada")).toHaveLength(1);
});

// ------------------------------- Botões -------------------------------

test("o botão anuncia quantas transações serão importadas", () => {
  montar({ linhas: [linha({ id: "a" }), linha({ id: "b" })] });
  expect(screen.getByRole("button", { name: /Importar 2 transação/ })).toBeEnabled();
});

test("DUPLICADO não conta para importar, mesmo com a caixa marcada", () => {
  // A regra vive em confirmar_importacao (0020): o servidor recusa DUPLICADO.
  // O botão espelha isso em vez de prometer o que o banco vai negar.
  montar({
    linhas: [
      linha({ id: "a", descricao: "UMA", classificacao: "DUPLICADO", ignorar: false }),
      linha({ id: "b", descricao: "OUTRA", classificacao: "DUPLICADO", ignorar: false }),
    ],
  });
  expect(screen.getByLabelText("Importar UMA")).toBeChecked();
  expect(screen.getByRole("button", { name: /Importar 0 transação/ })).toBeDisabled();
});

test("linha ignorada sai da conta do botão", () => {
  montar({
    linhas: [linha({ id: "a", ignorar: false }), linha({ id: "b", ignorar: true })],
  });
  expect(screen.getByRole("button", { name: /Importar 1 transação/ })).toBeEnabled();
});

test("pendente troca o rótulo e trava os dois botões", () => {
  montar({ pendente: true });
  expect(screen.getByRole("button", { name: "Importando..." })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Descartar" })).toBeDisabled();
});

test("confirmar e descartar chamam o container", async () => {
  const { onConfirmar, onDescartar } = montar();
  await userEvent.click(screen.getByRole("button", { name: /Importar 1 transação/ }));
  await userEvent.click(screen.getByRole("button", { name: "Descartar" }));
  expect(onConfirmar).toHaveBeenCalledTimes(1);
  expect(onDescartar).toHaveBeenCalledTimes(1);
});

test("erro do container aparece na tela", () => {
  montar({ erro: "Falha ao atualizar a linha" });
  expect(screen.getByText("Falha ao atualizar a linha")).toBeInTheDocument();
});
