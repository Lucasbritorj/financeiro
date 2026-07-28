import { test } from "node:test";
import assert from "node:assert/strict";
import {
  splitCsvLinha,
  detectarSeparador,
  normalizarData,
  valorParaCentavosAssinado,
  parseCsvExtrato,
  validarTetoLinhasImportacao,
  validarTamanhoArquivoImportacao,
} from "../../src/lib/csv.ts";
import { LIMITE_LINHAS_IMPORTACAO, LIMITE_BYTES_IMPORTACAO } from "../../src/lib/constantes.ts";

test("splitCsvLinha respeita aspas com separador interno", () => {
  assert.deepEqual(splitCsvLinha('2026-07-01,"Mercado, do bairro",-50.00', ","), [
    "2026-07-01",
    "Mercado, do bairro",
    "-50.00",
  ]);
  assert.deepEqual(splitCsvLinha('a;"b;c";d', ";"), ["a", "b;c", "d"]);
});

test("detectarSeparador escolhe o que gera mais colunas", () => {
  assert.equal(detectarSeparador("data,valor,descricao"), ",");
  assert.equal(detectarSeparador("data;valor;descricao"), ";");
});

test("normalizarData: ISO, BR e inválida", () => {
  assert.equal(normalizarData("2026-07-31"), "2026-07-31");
  assert.equal(normalizarData("31/07/2026"), "2026-07-31");
  assert.equal(normalizarData("31-07-2026"), "2026-07-31");
  assert.equal(normalizarData("julho"), null);
});

test("valorParaCentavosAssinado: sinais e formatos", () => {
  assert.equal(valorParaCentavosAssinado("-1.234,56"), -123456);
  assert.equal(valorParaCentavosAssinado("1234.56"), 123456);
  assert.equal(valorParaCentavosAssinado("R$ 10,00"), 1000);
  assert.equal(valorParaCentavosAssinado("+2500"), 250000);
  assert.equal(valorParaCentavosAssinado("0"), null);
  assert.equal(valorParaCentavosAssinado("abc"), null);
});

test("parseCsvExtrato: preset nubank (Data,Valor,Identificador,Descrição)", () => {
  const csv = [
    "Data,Valor,Identificador,Descrição",
    "05/07/2026,-41.00,abc123,IFOOD *RESTAURANTE",
    "01/07/2026,8500.00,def456,SALARIO EMPRESA",
    "linha,quebrada",
  ].join("\n");
  const r = parseCsvExtrato(csv, "nubank");
  assert.equal(r.linhas.length, 2);
  assert.equal(r.descartadas, 1);
  assert.deepEqual(r.linhas[0], {
    data: "2026-07-05",
    valor: -4100,
    descricao: "IFOOD *RESTAURANTE",
  });
  assert.equal(r.linhas[1].valor, 850000);
});

test("parseCsvExtrato: genérico detecta colunas pelo cabeçalho", () => {
  const csv = [
    "Data Lançamento;Histórico;Valor",
    "10/07/2026;SUPERMERCADO BOM;-620,00",
    "12/07/2026;PIX RECEBIDO;150,00",
  ].join("\n");
  const r = parseCsvExtrato(csv, "generico");
  assert.equal(r.linhas.length, 2);
  assert.equal(r.linhas[0].valor, -62000);
  assert.equal(r.linhas[1].descricao, "PIX RECEBIDO");
});

test("parseCsvExtrato: cabeçalho irreconhecível descarta tudo", () => {
  const csv = ["a;b;c", "1;2;3"].join("\n");
  const r = parseCsvExtrato(csv, "generico");
  assert.equal(r.linhas.length, 0);
  assert.equal(r.descartadas, 1);
});

// --- Bancos do usuário: Bradesco, Itaú, Caixa, Banco do Brasil ---

test("Bradesco: colunas Débito/Crédito separadas + preâmbulo -> sinal correto", () => {
  const csv = [
    "Extrato de Conta Corrente;;;;;",
    "Agência: 1234 Conta: 56789-0;;;;;",
    ";;;;;",
    "Data;Histórico;Docto.;Crédito (R$);Débito (R$);Saldo (R$)",
    "05/07/2026;COMPRA CARTAO SUPERMERCADO;000123;;620,00;1.380,00",
    "06/07/2026;PIX RECEBIDO JOAO;000456;150,00;;1.530,00",
  ].join("\n");
  const r = parseCsvExtrato(csv, "bradesco");
  assert.equal(r.linhas.length, 2);
  // BUG ORIGINAL: despesa de débito vinha como +receita. Agora sai negativa.
  assert.deepEqual(r.linhas[0], {
    data: "2026-07-05",
    valor: -62000,
    descricao: "COMPRA CARTAO SUPERMERCADO",
  });
  assert.equal(r.linhas[1].valor, 15000); // crédito = entrada
});

test("Itaú: coluna Valor única já com sinal", () => {
  const csv = [
    "data;lançamento;ag./origem;valor;saldo",
    "05/07/2026;REST FULANO;1234/56;-41,00;959,00",
    "01/07/2026;SALARIO EMPRESA;0000/00;8.500,00;9.459,00",
  ].join("\n");
  const r = parseCsvExtrato(csv, "itau");
  assert.equal(r.linhas.length, 2);
  assert.equal(r.linhas[0].valor, -4100);
  assert.equal(r.linhas[1].valor, 850000);
});

test("Caixa: sufixo D/C na célula de valor + preâmbulo", () => {
  const csv = [
    "Conta: 1234 000123456-7",
    "Período: 01/07/2026 a 31/07/2026",
    "Data Mov.;Nr. Doc.;Histórico;Valor;Saldo",
    "05/07/2026;000001;COMPRA DEBITO PADARIA;12,50 D;1.987,50",
    "06/07/2026;000002;DEPOSITO DINHEIRO;100,00 C;2.087,50",
  ].join("\n");
  const r = parseCsvExtrato(csv, "caixa");
  assert.equal(r.linhas.length, 2);
  assert.equal(r.linhas[0].valor, -1250); // "D" = débito = saída
  assert.equal(r.linhas[1].valor, 10000); // "C" = crédito = entrada
});

test("Banco do Brasil: Valor único com sinal + preâmbulo", () => {
  const csv = [
    "Banco do Brasil - Extrato de Conta Corrente",
    "Data;Histórico;Valor;Saldo",
    "05/07/2026;COMPRA CARTAO;-75,90;1.500,00",
    "07/07/2026;TED RECEBIDA;1.200,00;2.700,00",
  ].join("\n");
  const r = parseCsvExtrato(csv, "bb");
  assert.equal(r.linhas.length, 2);
  assert.equal(r.linhas[0].valor, -7590);
  assert.equal(r.linhas[1].valor, 120000);
});

test("parser não altera texto já decodificado (acentos preservados)", () => {
  const csv = [
    "Data;Histórico;Valor",
    "05/07/2026;Alimentação no Café;-30,00",
    "06/07/2026;Contas do Mês;-250,00",
  ].join("\n");
  const r = parseCsvExtrato(csv, "generico");
  assert.equal(r.linhas[0].descricao, "Alimentação no Café");
  assert.equal(r.linhas[1].descricao, "Contas do Mês");
});

// --- T-04: LIMITE_LINHAS_IMPORTACAO era declarado mas nunca importado/checado
// em lugar nenhum — um CSV de 500.000 linhas era aceito e parseado no cliente.

test("validarTetoLinhasImportacao: aceita até o teto do servidor, barra acima (T-04)", () => {
  assert.equal(validarTetoLinhasImportacao(LIMITE_LINHAS_IMPORTACAO), null);
  assert.equal(validarTetoLinhasImportacao(LIMITE_LINHAS_IMPORTACAO - 1), null);
  assert.equal(validarTetoLinhasImportacao(0), null);
  const erro500k = validarTetoLinhasImportacao(500000);
  assert.match(erro500k ?? "", /500000/);
  assert.match(erro500k ?? "", new RegExp(String(LIMITE_LINHAS_IMPORTACAO)));
});

test("validarTamanhoArquivoImportacao: aceita até o teto de bytes, barra acima (T-04)", () => {
  assert.equal(validarTamanhoArquivoImportacao(LIMITE_BYTES_IMPORTACAO), null);
  assert.equal(validarTamanhoArquivoImportacao(1024), null);
  assert.ok(validarTamanhoArquivoImportacao(LIMITE_BYTES_IMPORTACAO + 1) !== null);
});
