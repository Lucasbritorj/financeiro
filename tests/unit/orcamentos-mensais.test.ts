import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calcularOrcamento, validarMesOrcamento, lerCentavosComZero } from '../../src/lib/orcamentos-mensais.ts';

test('limite por mês preserva zero e usa padrão apenas quando não há definição', () => {
  assert.deepEqual(calcularOrcamento(0, 10000, 1200), { limite: 0, gasto: 1200, disponivel: -1200, excedido: true });
  assert.equal(calcularOrcamento(undefined, 10000, 1200).disponivel, 8800);
  assert.equal(calcularOrcamento(null, 10000, 1200).limite, null);
});
test('ausência de limite não vira saldo disponível inventado', () => {
  assert.equal(calcularOrcamento(undefined, null, 0).disponivel, null);
});
test('recusa centavos fracionados, negativos e inseguros', () => {
  for (const valor of [-1, 1.5, NaN, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => calcularOrcamento(valor, null, 0));
  }
});
test('orçamento aceita somente mês real entre 2000 e 2099', () => {
  assert.equal(validarMesOrcamento('2026-10'), true);
  for (const mes of ['2026-13', '2026-00', '26-10', '2026-10-01', '1999-12']) assert.equal(validarMesOrcamento(mes), false);
});
test('entrada de zero para saldo/limite é válida e difere de campo vazio',()=>{
 assert.equal(lerCentavosComZero('0,00'),0);
 assert.equal(lerCentavosComZero('0'),0);
 assert.equal(lerCentavosComZero(''),null);
 assert.equal(lerCentavosComZero('-12,34'),-1234);
});
