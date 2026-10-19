import {test} from 'node:test';
import assert from 'node:assert/strict';
import {deflateRawSync,crc32} from 'node:zlib';
import {prepararXlsxSeguro} from '../../src/lib/xlsx-seguro.ts';
import {matrizDoXlsx,lerArquivoImportacao,lerArquivoFatura} from '../../src/lib/leitura-arquivo.ts';
import ExcelJS from 'exceljs';

function zip(entradas:{nome:string;texto:string;declarado?:number;metodo?:number}[]) {
 const locais:Buffer[]=[],centrais:Buffer[]=[];let offset=0;
 for(const e of entradas){
  const nome=Buffer.from(e.nome),raw=Buffer.from(e.texto),metodo=e.metodo??8;
  const dados=metodo===0?raw:deflateRawSync(raw);const tamanho=e.declarado??raw.length;
  const l=Buffer.alloc(30);l.writeUInt32LE(0x04034b50);l.writeUInt16LE(20,4);l.writeUInt16LE(metodo,8);l.writeUInt32LE(crc32(raw),14);l.writeUInt32LE(dados.length,18);l.writeUInt32LE(tamanho,22);l.writeUInt16LE(nome.length,26);
  locais.push(l,nome,dados);
  const c=Buffer.alloc(46);c.writeUInt32LE(0x02014b50);c.writeUInt16LE(20,4);c.writeUInt16LE(20,6);c.writeUInt16LE(metodo,10);c.writeUInt32LE(crc32(raw),16);c.writeUInt32LE(dados.length,20);c.writeUInt32LE(tamanho,24);c.writeUInt16LE(nome.length,28);c.writeUInt32LE(offset,42);centrais.push(c,nome);offset+=l.length+nome.length+dados.length;
 }
 const central=Buffer.concat(centrais),fim=Buffer.alloc(22);fim.writeUInt32LE(0x06054b50);fim.writeUInt16LE(entradas.length,8);fim.writeUInt16LE(entradas.length,10);fim.writeUInt32LE(central.length,12);fim.writeUInt32LE(offset,16);
 return new Uint8Array(Buffer.concat([...locais,central,fim]));
}
test('XLSX: expansão real falsa e entrada irrelevante são limitadas',async()=>{
 const dados=zip([{nome:'xl/media/oculta.bin',texto:'x'.repeat(8*1024*1024+1),declarado:1}]);
 await assert.rejects(prepararXlsxSeguro(dados),/limite|expand/i);
});
test('XLSX: limite total e número de entradas são verificados',async()=>{
 const dados=zip(Array.from({length:4},(_,i)=>({nome:`parte${i}.bin`,texto:'a'.repeat(7*1024*1024)})));
 await assert.rejects(prepararXlsxSeguro(dados),/limite|expand/i);
 await assert.rejects(prepararXlsxSeguro(zip(Array.from({length:257},(_,i)=>({nome:`parte${i}`,texto:''})))),/entradas|limite/i);
});
test('XLSX: nomes duplicados, traversal, método desconhecido e CRC errado são recusados',async()=>{
 for(const nomes of [['xl/a.xml','xl/a.xml'],['../xl/a.xml'],['xl/../a.xml']])await assert.rejects(prepararXlsxSeguro(zip(nomes.map(nome=>({nome,texto:'ok'})))));
 await assert.rejects(prepararXlsxSeguro(zip([{nome:'a',texto:'x',metodo:99}])));
 const dados=zip([{nome:'a',texto:'x',metodo:0}]);dados[31]=120+1;await assert.rejects(prepararXlsxSeguro(dados),/integridade|CRC/i);
});
test('XLSX: XML esparso, entidades e dimensões gigantes são recusados',async()=>{
 for(const texto of ['<worksheet><row r="1048576"><c r="A1048576"/></row></worksheet>','<worksheet><row r="1"><c r="XFD1"/></row></worksheet>','<worksheet><row r="&#1048576;"/></worksheet>','<!DOCTYPE a [<!ENTITY x "abc">]><worksheet/>','<worksheet><dimension ref="A1:XFD1048576"/></worksheet>'])
  await assert.rejects(prepararXlsxSeguro(zip([{nome:'xl/worksheets/sheet1.xml',texto}])));
});
test('XLSX: cabeçalhos ambíguos, ZIP64 e criptografia são recusados',async()=>{
 const normal=()=>zip([{nome:'xl/a.xml',texto:'ok'}]);
 const divergente=normal();divergente[30]=122;await assert.rejects(prepararXlsxSeguro(divergente));
 const cifrado=normal();new DataView(cifrado.buffer).setUint16(6,1,true);await assert.rejects(prepararXlsxSeguro(cifrado));
 const zip64=normal();new DataView(zip64.buffer).setUint16(zip64.length-12,65535,true);await assert.rejects(prepararXlsxSeguro(zip64));
});
test('XLSX: nomes definidos não expandem intervalos ilimitados ou codificados',async()=>{
 for(const range of ['Extrato!$A$1:$XFD$1048576','Extrato!$A$1:$IV$10000','Extrato!$A$1:$A$&#1048576;'])
  await assert.rejects(prepararXlsxSeguro(zip([{nome:'xl/workbook.xml',texto:`<workbook><definedNames><definedName name="bomba">${range}</definedName></definedNames></workbook>`}])));
 const texto='<workbook><definedNames><definedName name="a">Extrato!$A$1:$J$10000</definedName><definedName name="b">Extrato!$A$1:$A$1</definedName></definedNames></workbook>';
 await assert.rejects(prepararXlsxSeguro(zip([{nome:'xl/workbook.xml',texto}])));
});
test('XLSX: XML malformado com muitos inícios de tag é recusado sem varredura quadrática',{timeout:5000},async()=>{
 const dados=zip([{nome:'xl/worksheets/sheet1.xml',texto:'<a'.repeat(100000)}]);
 await assert.rejects(matrizDoXlsx(new File([dados],'malformado.xlsx')));
});
test('XLSX: planilha legítima STORE e DEFLATE preserva valores, extrato e fatura',async()=>{
 for(const compression of ['STORE','DEFLATE'] as const){
  const wb=new ExcelJS.Workbook();const aba=wb.addWorksheet('Extrato');aba.addRow(['Data','Descrição','Valor']);aba.addRow(['01/10/2026','Mercado',-12.34]);
  wb.definedNames.add('Extrato!$A$1:$C$2','intervaloNormal');
  const dados=await wb.xlsx.writeBuffer({zip:{compression}});
  const arquivo=new File([new Uint8Array(dados)],'extrato.xlsx');
  const matriz=await matrizDoXlsx(arquivo);
  assert.deepEqual(matriz,[['Data','Descrição','Valor'],['01/10/2026','Mercado','-12.34']]);
  const extrato=await lerArquivoImportacao(arquivo,'XLSX','generico');assert.equal(extrato.linhas[0].valor,-1234);
  const fatura=await lerArquivoFatura(arquivo,'XLSX','2026-10');assert.equal(fatura.linhas[0].descricao,'Mercado');
 }
});
