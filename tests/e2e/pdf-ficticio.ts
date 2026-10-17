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
