// PDF textual inteiramente fictício, gerado sem depender de arquivo financeiro real.
export function pdfFicticio(linhas: string[]): Buffer {
 const escapar=(s:string)=>s.replace(/\\/g,'\\\\').replace(/\(/g,'\\(').replace(/\)/g,'\\)');
 const texto='BT /F1 11 Tf 40 800 Td '+linhas.map((s,i)=>`${i?'0 -22 Td ':''}(${escapar(s)}) Tj`).join('\n')+' ET';
 const objetos=[
  '<< /Type /Catalog /Pages 2 0 R >>',
  '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
  '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
  '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  `<< /Length ${Buffer.byteLength(texto)} >>\nstream\n${texto}\nendstream`,
 ];
 let pdf='%PDF-1.4\n'; const offsets=[0];
 objetos.forEach((o,i)=>{offsets.push(Buffer.byteLength(pdf));pdf+=`${i+1} 0 obj\n${o}\nendobj\n`;});
 const xref=Buffer.byteLength(pdf);
 pdf+=`xref\n0 ${objetos.length+1}\n0000000000 65535 f \n`+offsets.slice(1).map(n=>`${String(n).padStart(10,'0')} 00000 n \n`).join('');
 pdf+=`trailer\n<< /Size ${objetos.length+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
 return Buffer.from(pdf);
}

// Estrutura semelhante a uma fatura com tabelas lado a lado; dados inventados.
export function pdfFicticioColunas(): Buffer {
 type Trecho={texto:string;x:number;y:number};
 const t=(texto:string,x:number,y:number):Trecho=>({texto,x,y});
 const paginas:Trecho[][]=[[
  t('ITAU - FATURA FICTICIA',40,810),t('Vencimento: 08/09/2026',40,790),t('Total desta fatura 208,02',40,770),
  t('Pagamentos efetuados',40,740),t('DATA',40,720),t('VALOR EM R$',260,720),
  t('03/08',40,700),t('Pagamento via conta',75,700),t('-500,00',260,700),
  t('Lancamentos: compras e saques',40,650),t('DATA',40,630),t('ESTABELECIMENTO',75,630),t('VALOR EM R$',260,630),
  t('07/07',40,610),t('LOJA FICTICIA 03/05',75,610),t('82,11',260,610),
  t('Lancamentos: compras e saques',330,740),t('DATA',330,720),t('VALOR EM R$',520,720),
  t('20/08',330,700),t('Microsoft*Microsoft 365',365,700),t('49,90',540,700),
  t('Lancamentos internacionais',330,650),t('DATA',330,640),
  t('03/08',330,625),t('ANTHROPIC* CLAUDE SUB',365,625),t('73,44',540,625),
  t('70,00 BRL',365,610),t('13,67',540,610),
  t('Repasse de IOF em R$',330,575),t('2,57',540,575),t('Total dos lancamentos atuais 208,02',330,540),
 ],[
  t('Compras parceladas - proximas faturas',40,780),t('DATA',40,760),t('VALOR EM R$',260,760),
  t('07/07',40,740),t('LOJA FICTICIA 04/05',75,740),t('82,09',260,740),
  t('Proxima fatura 82,09',40,710),t('Demais faturas 82,09',40,690),t('Total para proximas faturas 164,18',40,670),
  t('Simulacao de Compras parc. c/ juros',40,620),t('01/10 OFERTA NAO CONTRATADA 999,00',40,600),
 ]];
 const escapar=(s:string)=>s.replace(/\\/g,'\\\\').replace(/\(/g,'\\(').replace(/\)/g,'\\)');
 const objetos=[
  '<< /Type /Catalog /Pages 2 0 R >>',
  `<< /Type /Pages /Kids [${paginas.map((_,i)=>`${4+i*2} 0 R`).join(' ')}] /Count ${paginas.length} >>`,
  '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
 ];
 paginas.forEach((trechos,i)=>{
  const texto=trechos.map(t=>`BT /F1 9 Tf 1 0 0 1 ${t.x} ${t.y} Tm (${escapar(t.texto)}) Tj ET`).join('\n');
  objetos.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5+i*2} 0 R >>`,
   `<< /Length ${Buffer.byteLength(texto)} >>\nstream\n${texto}\nendstream`);
 });
 let pdf='%PDF-1.4\n';const offsets=[0];
 objetos.forEach((o,i)=>{offsets.push(Buffer.byteLength(pdf));pdf+=`${i+1} 0 obj\n${o}\nendobj\n`;});
 const xref=Buffer.byteLength(pdf);
 pdf+=`xref\n0 ${objetos.length+1}\n0000000000 65535 f \n`+offsets.slice(1).map(n=>`${String(n).padStart(10,'0')} 00000 n \n`).join('');
 return Buffer.from(pdf+`trailer\n<< /Size ${objetos.length+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`);
}
