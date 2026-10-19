export function validarOcrPdf(paginas:number,bytes:number) {
 if(!Number.isInteger(paginas)||paginas<1||paginas>20)throw new Error('OCR aceita até 20 páginas por PDF. Divida o arquivo.');
 if(bytes>10*1024*1024||bytes<=0)throw new Error('OCR aceita arquivos de até 10 MB.');
}
export function reconstruirLinhasOcr(palavras:{text:string;x:number;y:number}[],altura:number) {
 return palavras.filter(p=>p.text.trim()).map(p=>({str:p.text.trim(),transform:[1,0,0,1,Math.round(p.x),Math.round(altura-p.y)]}));
}
export type OpcoesOcr={ocr?:boolean;progresso?:(texto:string)=>void;sinal?:AbortSignal};

export async function reconhecerPagina(canvas:HTMLCanvasElement,opcoes:OpcoesOcr) {
 if(canvas.width*canvas.height>8_000_000)throw new Error('Página muito grande para OCR. Exporte em resolução menor.');
 opcoes.sinal?.throwIfAborted();
 const {createWorker}=await import('tesseract.js');
 let worker:Awaited<ReturnType<typeof createWorker>>|undefined;
 let timer:ReturnType<typeof setTimeout>|undefined;
 const cancelar=()=>{void worker?.terminate();};
 opcoes.sinal?.addEventListener('abort',cancelar,{once:true});
 try{
  const tarefa=(async()=>{
   worker=await createWorker('por',1,{workerPath:'/ocr/worker.min.js',corePath:'/ocr',langPath:'/ocr',workerBlobURL:false,logger:m=>{if(m.status==='recognizing text')opcoes.progresso?.(`Reconhecendo texto: ${Math.round(m.progress*100)}%`);}});
   opcoes.sinal?.throwIfAborted();
   const {data}=await worker.recognize(canvas,{}, {text:true,blocks:true});
   opcoes.sinal?.throwIfAborted();
   const palavras=(data.blocks??[]).flatMap(b=>b.paragraphs.flatMap(p=>p.lines.flatMap(l=>l.words.map(w=>({text:w.text,x:w.bbox.x0,y:l.bbox.y0})))));
   if(!palavras.length)throw new Error('OCR não reconheceu texto. Confira a qualidade do PDF.');
   return reconstruirLinhasOcr(palavras,canvas.height);
  })();
  return await Promise.race([tarefa,new Promise<never>((_,reject)=>{timer=setTimeout(()=>{cancelar();reject(new Error('OCR excedeu 90 segundos nesta página. Tente um arquivo menor ou CSV/OFX.'));},90_000);})]);
 }finally{if(timer)clearTimeout(timer);opcoes.sinal?.removeEventListener('abort',cancelar);await worker?.terminate().catch(()=>{});}
}
