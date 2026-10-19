import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validarOcrPdf,reconstruirLinhasOcr} from '../../src/lib/ocr-financeiro.ts';
test('OCR limita páginas, bytes e tamanho de imagem antes de reconhecer',()=>{
 assert.doesNotThrow(()=>validarOcrPdf(3,100000));
 assert.throws(()=>validarOcrPdf(21,100000));
 assert.throws(()=>validarOcrPdf(1,11*1024*1024));
 assert.throws(()=>validarOcrPdf(0,1));
});
test('OCR preserva posição das palavras para reconstruir tabelas e revisão',()=>{
 const itens=reconstruirLinhasOcr([{text:'DATA',x:20,y:10},{text:'10/10',x:20,y:40},{text:'MERCADO',x:100,y:41},{text:'12,34',x:300,y:40}],400);
 assert.equal(itens[0].str,'DATA');assert.deepEqual(itens[1].transform,[1,0,0,1,20,360]);
 assert.equal(itens.length,4);
});
