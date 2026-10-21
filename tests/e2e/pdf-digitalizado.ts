/** PDF sintético sem camada de texto; a página é uma imagem JPEG desenhada no teste. */
export function pdfDigitalizado(jpeg:Buffer,largura:number,altura:number):Buffer {
 const conteudo=Buffer.from('q\n600 0 0 800 0 0 cm\n/Imagem Do\nQ');
 const objetos=[
  Buffer.from('<< /Type /Catalog /Pages 2 0 R >>'),
  Buffer.from('<< /Type /Pages /Kids [3 0 R] /Count 1 >>'),
  Buffer.from('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Resources << /XObject << /Imagem 5 0 R >> >> /Contents 4 0 R >>'),
  Buffer.concat([Buffer.from(`<< /Length ${conteudo.length} >>\nstream\n`),conteudo,Buffer.from('\nendstream')]),
  Buffer.concat([Buffer.from(`<< /Type /XObject /Subtype /Image /Width ${largura} /Height ${altura} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`),jpeg,Buffer.from('\nendstream')]),
 ];
 const partes=[Buffer.from('%PDF-1.4\n')];const offsets:number[]=[];let tamanho=partes[0].length;
 objetos.forEach((obj,i)=>{offsets.push(tamanho);const b=Buffer.concat([Buffer.from(`${i+1} 0 obj\n`),obj,Buffer.from('\nendobj\n')]);partes.push(b);tamanho+=b.length;});
 partes.push(Buffer.from(`xref\n0 6\n0000000000 65535 f \n${offsets.map(n=>String(n).padStart(10,'0')+' 00000 n ').join('\n')}\ntrailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${tamanho}\n%%EOF`));
 return Buffer.concat(partes);
}
