import { test, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { TransacaoLista, CategoriaOpcao, CartaoOpcao } from "@/components/lista-transacoes/tipos";

// Edição de transação mexe em dinheiro já lançado: a escolha errada de RPC
// deixa as parcelas dessincronizadas do cabeçalho — corrupção silenciosa que o
// usuário só descobre na fatura errada (o mesmo raciocínio do cabeçalho de
// tests/unit/edicao-transacao.test.ts).
//
// A DECISÃO de qual RPC usar já é testada isoladamente em edicao-transacao.ts.
// O que falta, e é o que este arquivo cobre, é o form CHAMAR a RPC certa com o
// payload certo, e devolver ao pai o objeto certo em cada caminho.

type Resposta = { data: unknown; error: unknown };
const rpc = vi.fn<(nome: string, params: unknown) => Promise<Resposta>>();

vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ rpc }) }));

const { FormEdicao } = await import("@/components/lista-transacoes/form-edicao");

const CATEGORIAS: CategoriaOpcao[] = [
  { id: "cat-mercado", nome: "Mercado", tipo: "DESPESA" },
  { id: "cat-salario", nome: "Salário", tipo: "RECEITA" },
];
const CARTOES: CartaoOpcao[] = [{ id: "cartao-1", nome: "Nubank" }];

// valor_total é MAGNITUDE, não valor assinado: paraCentavos() recusa <= 0 e o
// sinal vem do `tipo`. É convenção diferente da de LinhaImportacao, onde o
// valor é assinado.
function transacao(over: Partial<TransacaoLista> = {}): TransacaoLista {
  return {
    id: "tx-1",
    descricao: "MERCADO",
    valor_total: 5000,
    tipo: "DESPESA",
    forma_pagamento: "PIX",
    data_compra: "2026-07-09",
    data_vencimento: null,
    num_parcelas: 1,
    created_at: "2026-07-09T10:00:00Z",
    categoria_id: "cat-mercado",
    source: "MANUAL",
    natureza: null,
    ...over,
  };
}

function montar(over: Partial<TransacaoLista> = {}) {
  const aoSalvar = vi.fn();
  const aoFechar = vi.fn();
  render(
    <FormEdicao
      transacao={transacao(over)}
      categorias={CATEGORIAS}
      cartoes={CARTOES}
      aoFechar={aoFechar}
      aoSalvar={aoSalvar}
    />,
  );
  return { aoSalvar, aoFechar };
}

/** O submit do form, por papel — o botão muda de rótulo entre os dois layouts. */
function botaoSalvar() {
  return screen.getByRole("button", { name: /salvar/i });
}

beforeEach(() => {
  rpc.mockReset();
  rpc.mockResolvedValue({ data: null, error: null });
});

afterEach(() => vi.restoreAllMocks());

// ----------------------------- Validações -----------------------------

test("valor não numérico é recusado antes de qualquer RPC", async () => {
  const user = userEvent.setup();
  const { aoSalvar } = montar();

  const campoValor = screen.getByLabelText(/^Valor/);
  await user.clear(campoValor);
  await user.type(campoValor, "abc");
  await user.click(botaoSalvar());

  expect(screen.getByText("Valor inválido.")).toBeInTheDocument();
  expect(rpc).not.toHaveBeenCalled();
  expect(aoSalvar).not.toHaveBeenCalled();
});

test("boleto sem vencimento não submete: o required do HTML barra antes do JS", async () => {
  // Achado ao escrever este teste: o guard `if (ehBoleto && !vencimento)` em
  // salvar() é inalcançável pela UI. O input tem `required`, então a validação
  // nativa recusa o submit e o handler nem roda — a mensagem JS nunca aparece.
  // O guard fica como defesa em profundidade; o efeito observável é este.
  const user = userEvent.setup();
  const { aoSalvar } = montar({ forma_pagamento: "BOLETO", data_vencimento: null });

  await user.click(botaoSalvar());

  expect(screen.getByLabelText(/Vencimento/)).toBeRequired();
  expect(rpc).not.toHaveBeenCalled();
  expect(aoSalvar).not.toHaveBeenCalled();
});

// --------------------------- Caminho: boleto ---------------------------

test("boleto usa a RPC própria e devolve vencimento e competência ao pai", async () => {
  const user = userEvent.setup();
  const { aoSalvar } = montar({
    forma_pagamento: "BOLETO",
    data_vencimento: "2026-08-10",
    valor_total: 12000,
  });

  await user.click(botaoSalvar());

  expect(rpc).toHaveBeenCalledWith(
    "editar_boleto",
    expect.objectContaining({
      p_transacao_id: "tx-1",
      p_data_vencimento: "2026-08-10",
      p_data_competencia: "2026-07-09",
      p_alterar_categoria: true,
    }),
  );
  expect(aoSalvar).toHaveBeenCalledWith(
    expect.objectContaining({ id: "tx-1", data_vencimento: "2026-08-10" }),
  );
});

test("boleto não oferece tipo, forma nem parcelas", () => {
  // O form do boleto é dedicado: mostrar forma de pagamento ali convidaria a
  // uma troca que a RPC de boleto não faz.
  montar({ forma_pagamento: "BOLETO", data_vencimento: "2026-08-10" });
  expect(screen.getByLabelText(/Vencimento/)).toBeInTheDocument();
  expect(screen.queryByLabelText(/Forma/)).not.toBeInTheDocument();
  expect(screen.queryByLabelText(/Parcelas/)).not.toBeInTheDocument();
});

// ------------------------ Caminho: edição barata ------------------------

test("mudar só a descrição usa editar_transacao e mantém as parcelas", async () => {
  // A RPC barata NÃO recria parcelas. É o caminho certo justamente porque nada
  // que afete o parcelamento mudou.
  const user = userEvent.setup();
  const { aoSalvar } = montar({ forma_pagamento: "CREDITO", num_parcelas: 3 });

  const campo = screen.getByLabelText(/Descrição/);
  await user.clear(campo);
  await user.type(campo, "PADARIA");
  await user.click(botaoSalvar());

  expect(rpc).toHaveBeenCalledWith(
    "editar_transacao",
    expect.objectContaining({ p_transacao_id: "tx-1", p_descricao: "PADARIA" }),
  );
  expect(rpc).not.toHaveBeenCalledWith("substituir_transacao", expect.anything());
  expect(aoSalvar).toHaveBeenCalledWith(
    expect.objectContaining({ descricao: "PADARIA", num_parcelas: 3 }),
  );
});

test("a descrição vai para a RPC sem espaço nas pontas", async () => {
  const user = userEvent.setup();
  montar();
  const campo = screen.getByLabelText(/Descrição/);
  await user.clear(campo);
  await user.type(campo, "  FEIRA  ");
  await user.click(botaoSalvar());

  expect(rpc.mock.calls[0][1]).toMatchObject({ p_descricao: "FEIRA" });
});

// --------------------- Caminho: substituição (recria) ---------------------

test("mudar a categoria recria a transação e adota o id novo", async () => {
  const user = userEvent.setup();
  rpc.mockResolvedValue({ data: { transacao_id: "tx-novo" }, error: null });
  const { aoSalvar } = montar();

  await user.selectOptions(screen.getByLabelText(/Categoria/), "");
  await user.click(botaoSalvar());

  expect(rpc).toHaveBeenCalledWith(
    "substituir_transacao",
    expect.objectContaining({ p_transacao_id: "tx-1", p_categoria_id: null }),
  );
  // O id muda: a transação antiga foi substituída por uma nova.
  expect(aoSalvar).toHaveBeenCalledWith(expect.objectContaining({ id: "tx-novo" }));
});

test("sem transacao_id no retorno, o id antigo é preservado", async () => {
  // Evita devolver `undefined` como id para a lista do pai.
  const user = userEvent.setup();
  rpc.mockResolvedValue({ data: null, error: null });
  const { aoSalvar } = montar();

  await user.selectOptions(screen.getByLabelText(/Categoria/), "");
  await user.click(botaoSalvar());

  expect(aoSalvar).toHaveBeenCalledWith(expect.objectContaining({ id: "tx-1" }));
});

test("fora do crédito, cartão vai nulo e parcelas voltam a 1", async () => {
  const user = userEvent.setup();
  rpc.mockResolvedValue({ data: { transacao_id: "tx-2" }, error: null });
  const { aoSalvar } = montar({ forma_pagamento: "CREDITO", num_parcelas: 6 });

  await user.selectOptions(screen.getByLabelText(/Forma/), "PIX");
  await user.click(botaoSalvar());

  expect(rpc).toHaveBeenCalledWith(
    "substituir_transacao",
    expect.objectContaining({ p_cartao_id: null, p_num_parcelas: 1 }),
  );
  expect(aoSalvar).toHaveBeenCalledWith(expect.objectContaining({ num_parcelas: 1 }));
});

// ------------------------------- Erros -------------------------------

test("erro da RPC é exibido e o pai não é notificado", async () => {
  // Notificar aoSalvar com erro deixaria a lista mostrando um dado que o banco
  // recusou.
  const user = userEvent.setup();
  rpc.mockResolvedValue({ data: null, error: { message: "fatura já paga" } });
  const { aoSalvar } = montar();

  const campo = screen.getByLabelText(/Descrição/);
  await user.clear(campo);
  await user.type(campo, "OUTRA");
  await user.click(botaoSalvar());

  expect(screen.getByText(/fatura já paga/)).toBeInTheDocument();
  expect(aoSalvar).not.toHaveBeenCalled();
});

test("erro no caminho do boleto também não notifica o pai", async () => {
  const user = userEvent.setup();
  rpc.mockResolvedValue({ data: null, error: { message: "boleto travado" } });
  const { aoSalvar } = montar({ forma_pagamento: "BOLETO", data_vencimento: "2026-08-10" });

  await user.click(botaoSalvar());

  expect(screen.getByText(/boleto travado/)).toBeInTheDocument();
  expect(aoSalvar).not.toHaveBeenCalled();
});

// ------------------------------ Interface ------------------------------

test("o seletor de categoria segue o tipo escolhido", async () => {
  // Categoria de RECEITA não pode aparecer numa despesa.
  const user = userEvent.setup();
  montar({ tipo: "DESPESA" });

  const categoria = screen.getByLabelText(/Categoria/);
  expect(categoria.textContent).toContain("Mercado");
  expect(categoria.textContent).not.toContain("Salário");

  await user.selectOptions(screen.getByLabelText(/Tipo/), "RECEITA");
  expect(screen.getByLabelText(/Categoria/).textContent).toContain("Salário");
});

test("cancelar avisa o pai sem tocar no banco", async () => {
  const user = userEvent.setup();
  const { aoFechar } = montar();
  await user.click(screen.getByRole("button", { name: /cancelar/i }));
  expect(aoFechar).toHaveBeenCalledTimes(1);
  expect(rpc).not.toHaveBeenCalled();
});
