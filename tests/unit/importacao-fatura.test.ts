import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analisarLinhaFatura, parsePdfFatura, preverParcelas, resumoFatura, validarLinhasFatura } from '../../src/lib/importacao-fatura.ts';
import {parseCsvExtrato,parseMatrizExtrato} from '../../src/lib/csv.ts';

test('parcela finita tem precedência sobre serviço conhecido', () => {
  const l = analisarLinhaFatura({data:'2026-09-10',valor:-10000,descricao:'NETFLIX parcela 03/10'});
  assert.equal(l.tipo,'PARCELA'); assert.equal(l.parcela_numero,3); assert.equal(l.parcelas_total,10);
});
test('data no nome e códigos isolados não comprovam parcela', () => {
  for(const descricao of ['LOJA 01/12 CENTRO','PEDIDO 03/10','MERCADO 123'])
    assert.equal(analisarLinhaFatura({data:'2026-09-10',valor:-1000,descricao}).tipo,'GASTO');
});
test('marcador final 03/10 de compra é sugestão editável', () => {
  const l=analisarLinhaFatura({data:'2026-09-10',valor:-10000,descricao:'LOJA MOVEIS 03/10'});
  assert.equal(l.tipo,'PARCELA'); assert.match(l.motivo,/parcela/i);
});
test('possível assinatura exige decisão; desconhecida não prova recorrência', () => {
  const l=analisarLinhaFatura({data:'2026-09-10',valor:-3990,descricao:'NETFLIX.COM'});
  assert.equal(l.tipo,'ASSINATURA'); assert.equal(l.decisao_assinatura,'PENDENTE');
  assert.match(validarLinhasFatura([l]) ?? '',/assinatura/i);
  assert.equal(analisarLinhaFatura({data:'2026-09-10',valor:-3990,descricao:'SERVICO DESCONHECIDO'}).tipo,'GASTO');
});
test('pagamentos/totais são ignorados; juros são gastos; créditos bloqueados', () => {
  for(const descricao of ['PAGAMENTO EFETUADO','TOTAL DA FATURA','SALDO ANTERIOR']) {
    const l=analisarLinhaFatura({data:'2026-09-10',valor:-10000,descricao});
    assert.equal(l.tipo,'INFORMATIVO'); assert.equal(l.ignorar,true);
  }
  assert.equal(analisarLinhaFatura({data:'2026-09-10',valor:-1000,descricao:'JUROS DO ROTATIVO'}).tipo,'GASTO');
  const estorno=analisarLinhaFatura({data:'2026-09-10',valor:1000,descricao:'ESTORNO LOJA'});
  assert.equal(estorno.tipo,'AJUSTE'); assert.match(validarLinhasFatura([estorno]) ?? '',/crédito|estorno/i);
});
test('Itaú fictício: ano vem da competência, linhas quebradas e total preservados', () => {
  const r=parsePdfFatura(['ITAÚ - FATURA','Lançamentos: compras e saques','15/12 LOJA MOVEIS','03/10 100,00','16/12 NETFLIX.COM 39,90','Total desta fatura 139,90'], '2027-01');
  assert.equal(r.linhas.length,2); assert.equal(r.linhas[0].data,'2026-12-15');
  assert.equal(r.linhas[0].valor,10000); assert.equal(r.linhas[0].tipo,'PARCELA');
  assert.equal(r.total_informado,13990);
});
test('PDF sem texto/sem lançamentos falha de forma explícita', () => {
  assert.throws(()=>parsePdfFatura([], '2026-10'),/texto|lançamento/i);
  assert.throws(()=>parsePdfFatura(['Resumo da fatura 50,00'], '2026-10'),/lançamento/i);
});
test('PDF separa data e parcela e não assume ano atual', () => {
  assert.throws(()=>parsePdfFatura(['05/10 LOJA 100,00'], ''),/mês|competência/i);
  const r=parsePdfFatura(['05/10 LOJA parcela 1 de 3 100,00'],'2026-10');
  assert.equal(r.linhas[0].parcela_numero,1); assert.equal(r.linhas[0].parcelas_total,3);
});
test('PDF créditos e totais não viram compras', () => {
  const r=parsePdfFatura(['10/10 COMPRA 100,00','11/10 ESTORNO COMPRA -20,00','Total desta fatura 80,00'],'2026-10');
  assert.equal(r.linhas[1].tipo,'AJUSTE'); assert.equal(r.total_informado,8000);
});
test('PDF com duas compras na mesma linha não soma uma compra fictícia',()=>{
 const r=parsePdfFatura(['05/10 MERCADO 10,00 06/10 FARMACIA 20,00','07/10 COMPRA VALIDA 30,00'],'2026-10');
 assert.equal(r.linhas.length,1);assert.equal(r.descartadas,1);
});
test('PDF com seções de cartões diferentes é bloqueado, sem misturar despesas',()=>{
 assert.throws(()=>parsePdfFatura(['Cartao final 1234','05/10 LOJA 100,00','Cartao final 5678','06/10 MERCADO 20,00'],'2026-10'),/cartões|cartoes/i);
});
test('CSV/XLSX em modo fatura preservam crédito explícito e exigem revisão do sinal desconhecido',()=>{
 const csv='Data;Descricao;Valor;D/C\n05/10/2026;LOJA;100,00;D\n06/10/2026;LOJA;20,00;C';
 const linhas=parseCsvExtrato(csv,'itau',true).linhas.map(analisarLinhaFatura);
 assert.equal(linhas[0].tipo,'GASTO');assert.equal(linhas[1].tipo,'AJUSTE');
 const planilha=parseMatrizExtrato([['Data','Descricao','Valor','D/C'],['06/10/2026','LOJA','20,00','C']],true);
 assert.equal(analisarLinhaFatura(planilha.linhas[0]).tipo,'AJUSTE');
 const desconhecida=analisarLinhaFatura(parseCsvExtrato('Data;Descricao;Valor\n05/10/2026;LOJA;100,00','itau',true).linhas[0]);
 assert.match(validarLinhasFatura([desconhecida])??'',/sinal/i);
 assert.equal(validarLinhasFatura([{...desconhecida,sinal_confirmado:true}]),null);
});
test('3/10 prevê sete futuras; parcela atual não é previsão', () => {
  const p=preverParcelas({id:'p',competencia_base:'2026-10-01',parcela_base:3,parcelas_total:10,valor_previsto:10000},[]);
  assert.equal(p.length,7); assert.equal(p[0].competencia,'2026-11-01'); assert.equal(p[0].numero,4);
  assert.equal(p.at(-1)?.numero,10); assert.equal(p.reduce((s,x)=>s+x.valor,0),70000);
});
test('cobrança confirmada remove somente previsão correspondente', () => {
  const p=preverParcelas({id:'p',competencia_base:'2026-10-01',parcela_base:3,parcelas_total:5,valor_previsto:10000},[4]);
  assert.deepEqual(p.map(x=>x.numero),[5]);
});
test('revisão soma reais/previsões separadamente e explicita ajustes', () => {
  const gasto=analisarLinhaFatura({data:'2026-10-01',valor:-10000,descricao:'LOJA 03/10'});
  const ajuste=analisarLinhaFatura({data:'2026-10-01',valor:2000,descricao:'ESTORNO'});
  assert.deepEqual(resumoFatura([gasto,ajuste]),{cobrancas:10000,previsoes:70000,ajustes:2000,pendentes:1,ignoradas:0});
});
test('guarda dinheiro, data, parcelas e escolha de assinatura', () => {
  const l=analisarLinhaFatura({data:'2026-10-01',valor:-100,descricao:'LOJA'});
  assert.equal(validarLinhasFatura([l]),null);
  assert.ok(validarLinhasFatura([{...l,valor:1.5}]));
  assert.ok(validarLinhasFatura([{...l,tipo:'PARCELA',parcela_numero:4,parcelas_total:3}]));
  assert.ok(validarLinhasFatura([{...l,tipo:'PARCELA',parcela_numero:1,parcelas_total:121}]));
  assert.ok(validarLinhasFatura([{...l,data:'2026-02-30'}]));
});
