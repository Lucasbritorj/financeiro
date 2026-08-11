import { test } from "node:test";
import assert from "node:assert/strict";
import { parseOfxExtrato, dataOfxParaIso, valorOfxParaCentavos } from "../../src/lib/ofx.ts";

// OFX 1.x real: SGML, tags de folha SEM fechamento.
const OFX_SGML = `OFXHEADER:100
DATA:OFXSGML
CHARSET:1252

<OFX>
<BANKMSGSRSV1><STMTTRNRS><STMTRS><BANKTRANLIST>
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20260705120000[-3:BRT]
<TRNAMT>-89.90
<FITID>2026070501
<MEMO>IFOOD *RESTAURANTE
</STMTTRN>
<STMTTRN>
<TRNTYPE>CREDIT
<DTPOSTED>20260701
<TRNAMT>4500.00
<FITID>2026070102
<NAME>SALARIO ACME &amp; CIA
</STMTTRN>
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>INVALIDA
<TRNAMT>-10.00
<MEMO>lixo
</STMTTRN>
</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1>
</OFX>`;

test("parseOfxExtrato: SGML sem fechamento, MEMO/NAME, entidades e descarte", () => {
  const r = parseOfxExtrato(OFX_SGML);
  assert.equal(r.linhas.length, 2);
  assert.equal(r.descartadas, 1);
  // ATÉ A 0020 este teste afirmava só {data, valor, descricao} — o FITID da
  // fixture era lido e jogado fora. Hoje ele sai como id_externo e vira a
  // chave de dedup preferida no servidor. A expectativa mudou porque o
  // comportamento mudou de propósito; não é regressão.
  assert.deepEqual(r.linhas[0], {
    data: "2026-07-05",
    valor: -8990,
    descricao: "IFOOD *RESTAURANTE",
    id_externo: "2026070501",
  });
  assert.deepEqual(r.linhas[1], {
    data: "2026-07-01",
    valor: 450000,
    descricao: "SALARIO ACME & CIA",
    id_externo: "2026070102",
  });
});

test("parseOfxExtrato: XML (OFX 2.x) com tags fechadas também funciona", () => {
  const xml = `<?xml version="1.0"?><OFX><STMTTRN><DTPOSTED>20260610</DTPOSTED><TRNAMT>-55,50</TRNAMT><MEMO>UBER</MEMO></STMTTRN></OFX>`;
  const r = parseOfxExtrato(xml);
  assert.deepEqual(r.linhas, [{ data: "2026-06-10", valor: -5550, descricao: "UBER" }]);
});

test("parseOfxExtrato: OFC com bloco <TRANSACTION>", () => {
  const ofc = `<OFC><ACCTSTMT><TRANSACTION><DTPOSTED>20260603</DTPOSTED><TRNAMT>-120.00</TRNAMT><MEMO>MERCADO</MEMO></TRANSACTION></ACCTSTMT></OFC>`;
  const r = parseOfxExtrato(ofc);
  assert.deepEqual(r.linhas, [{ data: "2026-06-03", valor: -12000, descricao: "MERCADO" }]);
});

test("dataOfxParaIso e valorOfxParaCentavos: casos de borda", () => {
  assert.equal(dataOfxParaIso("20261231235959"), "2026-12-31");
  assert.equal(dataOfxParaIso("2026-07-05"), null);
  assert.equal(dataOfxParaIso("20261301"), null); // mês 13
  assert.equal(valorOfxParaCentavos("-89.9"), -8990);
  assert.equal(valorOfxParaCentavos("0.00"), null);
  assert.equal(valorOfxParaCentavos("abc"), null);
  // Regressão: valor com separador de milhar agora é aceito (antes: null).
  assert.equal(valorOfxParaCentavos("1.234,56"), 123456);
  assert.equal(valorOfxParaCentavos("-1.234,56"), -123456);
});

// 0020: FITID é o identificador que o banco dá ao lançamento e é estável
// entre exportações do mesmo extrato. Antes era descartado pelo parser, o que
// obrigava a dedup a cair no fingerprint heurístico mesmo quando havia um id
// autoritativo disponível.
test("parseOfxExtrato: FITID vira id_externo quando existe", () => {
  const ofx = `<STMTTRN><DTPOSTED>20260702</DTPOSTED><TRNAMT>-15,50</TRNAMT><MEMO>PADARIA</MEMO><FITID>2026070200123</FITID></STMTTRN>`;
  const r = parseOfxExtrato(ofx);
  assert.deepEqual(r.linhas, [
    { data: "2026-07-02", valor: -1550, descricao: "PADARIA", id_externo: "2026070200123" },
  ]);
});

test("parseOfxExtrato: sem FITID a linha NÃO ganha id_externo undefined", () => {
  const ofx = `<STMTTRN><DTPOSTED>20260702</DTPOSTED><TRNAMT>-15,50</TRNAMT><MEMO>PADARIA</MEMO></STMTTRN>`;
  const r = parseOfxExtrato(ofx);
  // Sem a chave, e não com valor undefined: o RPC recebe o JSON e
  // `"id_externo": undefined` viraria ausente de qualquer forma, mas a
  // ausência explícita mantém o contrato honesto e o deepEqual estável.
  assert.deepEqual(r.linhas, [{ data: "2026-07-02", valor: -1550, descricao: "PADARIA" }]);
  assert.equal("id_externo" in r.linhas[0], false);
});

test("parseOfxExtrato: FITID vazio é tratado como ausente", () => {
  const ofx = `<STMTTRN><DTPOSTED>20260702</DTPOSTED><TRNAMT>-15,50</TRNAMT><MEMO>PADARIA</MEMO><FITID></FITID></STMTTRN>`;
  const r = parseOfxExtrato(ofx);
  assert.equal("id_externo" in r.linhas[0], false);
});
