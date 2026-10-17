import { test } from 'node:test';
import assert from 'node:assert/strict';
import { linhasDaPagina } from '../../src/lib/leitura-arquivo.ts';
import { parsePdfExtrato } from '../../src/lib/pdf-extrato.ts';
import { analisarLinhaFatura, parsePdfFatura, resumoFatura, validarLinhasFatura } from '../../src/lib/importacao-fatura.ts';

const item=(str:string,x:number,y:number)=>({str,transform:[1,0,0,1,x,y]});
const documento = [
 'Resumo da fatura em R$', 'Vencimento: 08/09/2026', 'Total desta fatura 208,02',
 'Pagamentos efetuados','03/08 Pagamento via conta -500,00',
 'Lançamentos: compras e saques','DATA ESTABELECIMENTO VALOR EM R$',
 '07/07 LOJA FICTICIA 03/05 82,11','20/08 Microsoft*Microsoft 365 49,90',
 'Lançamentos no cartão 132,01','Lançamentos internacionais',
 '03/08 ANTHROPIC* CLAUDE SUB 73,44','70,00 BRL 13,67','Dólar de Conversão R$ 5,37',
 'Total transações inter. em R$ 73,44','Repasse de IOF em R$ 2,57',
 'Total lançamentos inter. em R$ 76,01','Total dos lançamentos atuais 208,02',
 'Compras parceladas - próximas faturas','07/07 LOJA FICTICIA 04/05 82,09',
 'Próxima fatura 82,09','Demais faturas 82,09','Total para próximas faturas 164,18',
 'Simulação de Compras parc. c/ juros','01/10 OFERTA NAO CONTRATADA 999,00',
];

test('CA2: duas tabelas preservam colunas em vez de juntar pagamento e compra',()=>{
 const itens=[item('DATA',100,700),item('VALOR EM R$',270,700),item('DATA',350,700),item('VALOR EM R$',520,700),
 item('03/08',100,680),item('Pagamento via conta',140,680),item('-500,00',290,680),
 item('15/08',350,680),item('CLUBE FICTICIO',390,680),item('30,00',540,680)];
 assert.deepEqual(linhasDaPagina(itens,true),['DATA VALOR EM R$','03/08 Pagamento via conta -500,00','DATA VALOR EM R$','15/08 CLUBE FICTICIO 30,00']);
});
test('CA1: fatura não pode ser lida silenciosamente como extrato',()=>{
 assert.throws(()=>parsePdfExtrato(documento,2026),/fatura.*cartão|fatura.*cartao/i);
});
test('CA3/4/5: atuais, futuras e IOF fecham sem incluir pagamentos, resumos ou ofertas',()=>{
 const r=parsePdfFatura(documento,'2026-09');
 const ativas=r.linhas.filter(l=>!l.ignorar);
 assert.equal(ativas.length,4);
 assert.equal(resumoFatura(r.linhas).cobrancas,20802);
 assert.equal(resumoFatura(r.linhas).previsoes,16418);
 assert.equal(r.total_informado,20802);assert.equal(r.descartadas,0);
 const iof=ativas.find(l=>/IOF/.test(l.descricao));assert.equal(iof?.valor,257);assert.match(iof?.motivo??'',/referência|referencia|vencimento/i);
 const futura=r.linhas.find(l=>l.descricao.includes('04/05'));assert.ok(futura?.ignorar);assert.equal(futura?.tipo,'INFORMATIVO');
 assert.match(validarLinhasFatura([{...futura!,ignorar:false}])??'',/pagamento|total|informativa|futura/i);
});
test('CA6: ano considera parcela final no mesmo mês e exige conferência',()=>{
 const r=parsePdfFatura(['08/09 LOJA FICTICIA 12/12 30,00','02/10 OUTRA LOJA 11/12 40,00'],'2026-09');
 assert.deepEqual(r.linhas.map(l=>l.data),['2025-09-08','2025-10-02']);
 assert.match(validarLinhasFatura(r.linhas)??'',/data/i);
 assert.throws(()=>parsePdfFatura(documento,'2026-10'),/vencimento|competência|competencia/i);
});
test('CA5/8: valor previsto inválido não passa; usa valor futuro sem alterar cobrança',()=>{
 const l=analisarLinhaFatura({data:'2026-09-01',valor:8211,descricao:'LOJA 3/5'});
 assert.equal(resumoFatura([{...l,valor_previsto:8209}]).previsoes,16418);
 assert.ok(validarLinhasFatura([{...l,valor_previsto:-1}]));
});
test('CA7: serviços concatenados e internacionais são sugestões, marketplace é parcela',()=>{
 for(const descricao of ['APPLE.COM/BILLSAO PAULO','Microsoft*Microsoft 365','Smiles Clube SmilesBaru','ANTHROPIC* CLAUDE SUBAN']) {
  const l=analisarLinhaFatura({data:'2026-09-01',valor:2500,descricao});
  assert.equal(l.tipo,'ASSINATURA',descricao);assert.match(validarLinhasFatura([l])??'',/assinatura/i);
 }
 assert.equal(analisarLinhaFatura({data:'2026-09-01',valor:2500,descricao:'AMAZONMKTPLC*LOJA 03/05'}).tipo,'PARCELA');
});
test('CA5: duas atuais compatíveis não recebem vínculo futuro arbitrário',()=>{
 const r=parsePdfFatura(['Lançamentos: compras e saques','07/07 LOJA 03/05 82,11','07/07 LOJA 03/05 82,11',
  'Compras parceladas - próximas faturas','07/07 LOJA 04/05 82,09'],'2026-09');
 assert.ok(r.linhas.filter(l=>l.tipo==='PARCELA').every(l=>l.valor_previsto===undefined));
});

test('CA8: total anterior não substitui total atual e totais conflitantes bloqueiam',()=>{
 const r=parsePdfFatura(['01/09 LOJA 10,00','Total desta fatura 10,00','Total da fatura anterior 50,00'],'2026-09');
 assert.equal(r.total_informado,1000);
 assert.throws(()=>parsePdfFatura(['01/09 LOJA 10,00','Total desta fatura 10,00','Total desta fatura 50,00'],'2026-09'),/totais.*diferentes/i);
});
