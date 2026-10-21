import {test} from 'node:test';
import assert from 'node:assert/strict';
import {calcularFluxo,explicarSugestao} from '../../src/lib/previsao-caixa.ts';
const ev=(id:string,data:string,valor:number,tipo:'ENTRADA'|'SAIDA')=>({id,data,valor,tipo,descricao:id,situacao:'PREVISTA' as const,origem:'/transacoes'});
test('detecta falta antes do salário apesar de fechamento positivo, sem alterar base',()=>{
 const eventos=[ev('conta','2026-10-09',15000,'SAIDA'),ev('salario','2026-10-15',30000,'ENTRADA')];
 const r=calcularFluxo(10000,eventos,'2026-10-01','2026-12-29');
 assert.equal(r.final,25000);assert.equal(r.minimo,-5000);assert.equal(r.dataMinimo,'2026-10-09');assert.equal(r.compromissosMes,15000);assert.equal(eventos.length,2);
});
test('atraso: despesa pendente reduz previsão hoje e receita atrasada não é recebimento presumido',()=>{
 const r=calcularFluxo(10000,[ev('conta','2026-09-30',3000,'SAIDA'),ev('salario','2026-09-30',20000,'ENTRADA')],'2026-10-01','2026-12-29');
 assert.equal(r.final,7000);assert.equal(r.dias[0].data,'2026-10-01');assert.equal(r.receitasAtrasadas,1);
});
test('duplicidade, datas irreais e dinheiro fracionário falham em vez de inventar saldo',()=>{
 const a=ev('mesmo','2026-10-01',100,'ENTRADA');
 assert.throws(()=>calcularFluxo(0,[a,a],'2026-10-01','2026-12-29'));
 assert.throws(()=>calcularFluxo(0,[ev('x','2026-02-30',100,'ENTRADA')],'2026-10-01','2026-12-29'));
 assert.throws(()=>calcularFluxo(0,[ev('x','2026-10-01',1.5,'ENTRADA')],'2026-10-01','2026-12-29'));
});
test('explica metas concluídas e capacidade insuficiente sem criar aportes',()=>{
 assert.match(explicarSugestao({valor_alvo:100,saldo_atual:100},0),/concluída/i);
 assert.match(explicarSugestao({valor_alvo:10000,saldo_atual:100},0),/capacidade|prioridades/i);
 assert.match(explicarSugestao({valor_alvo:10000,saldo_atual:100},1000),/10,00/);
});
