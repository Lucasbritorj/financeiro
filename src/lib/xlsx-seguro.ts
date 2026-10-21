// Fronteira única antes do ExcelJS. Não confiar nos tamanhos declarados do ZIP.
const MAX_ARQUIVO=10*1024*1024,MAX_ENTRADA=8*1024*1024,MAX_TOTAL=24*1024*1024,MAX_ENTRADAS=256;
const erro=()=>new Error('Planilha inválida ou acima dos limites de leitura segura. Exporte um arquivo menor ou use CSV.');
const encoder=new TextEncoder();
const decoder=new TextDecoder('utf-8',{fatal:true});
type Entrada={nome:string;bytes:Uint8Array;crc:number};

function crc32(bytes:Uint8Array):number {
 let crc=0xffffffff;
 for(const b of bytes){crc^=b;for(let bit=0;bit<8;bit++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}
 return (crc^0xffffffff)>>>0;
}

async function expandir(bytes:Uint8Array,metodo:number,limite:number):Promise<Uint8Array> {
 if(metodo===0){if(bytes.length>limite)throw erro();return bytes;}
 // Entrada em pequenos blocos também limita o trabalho de cada write nativo.
 let offset=0;
 let stream:ReadableStream<Uint8Array>;
 try{
  stream=new ReadableStream<BufferSource>({pull(c){
   if(offset>=bytes.length){c.close();return;}
   const fim=Math.min(offset+1024,bytes.length);c.enqueue(bytes.slice(offset,fim));offset=fim;
  }}).pipeThrough(new DecompressionStream('deflate-raw'));
 }catch{throw new Error('Seu navegador não oferece leitura segura de XLSX. Atualize o navegador ou use CSV.');}
 const reader=stream.getReader();const partes:Uint8Array[]=[];let total=0;
 try{
  while(true){const {done,value}=await reader.read();if(done)break;
   total+=value.byteLength;if(total>limite)throw erro();partes.push(value);
  }
 }catch{await reader.cancel().catch(()=>{});throw erro();}
 finally{reader.releaseLock();}
 const resultado=new Uint8Array(total);let p=0;
 for(const parte of partes){resultado.set(parte,p);p+=parte.length;}
 return resultado;
}

function validarXml(bytes:Uint8Array,contagem:{elementos:number;referencias:number}) {
 const xml=decoder.decode(bytes);
 if(/<!DOCTYPE|<!ENTITY/i.test(xml))throw erro();
 // O leitor interpreta referências numéricas de atributos. Recusar formas
 // não canônicas nos endereços impede divergência com seu parser XML.
 const atributo=(tag:string,nome:string)=>{
  const encontrados=[...tag.matchAll(new RegExp(`\\s${nome}\\s*=\\s*(["'])(.*?)\\1`,'gs'))];
  if(encontrados.length>1)throw erro();return encontrados[0]?.[2];
 };
 const numero=(s:string|undefined,max:number)=>{if(s===undefined||!/^\d{1,5}$/.test(s)||Number(s)<1||Number(s)>max)throw erro();};
 const celula=(s:string)=>{
  const m=/^([A-Z]{1,3})([1-9]\d{0,4})$/.exec(s);if(!m)throw erro();
  let col=0;for(const c of m[1])col=col*26+c.charCodeAt(0)-64;
  if(col>256||Number(m[2])>10000)throw erro();
  return {col,linha:Number(m[2])};
 };
 const definedName=/<definedName\b[^<>]*>([^<]*)<\/definedName\s*>/y;
 let linhas=0,celulas=0;
 // Não atravessar outro '<' ao procurar fim de tag malformada: evita
 // percorrer repetidamente o restante do XML quando falta o fechamento.
 for(const tag of xml.matchAll(/<([A-Za-z][\w:.-]*)(?=[\s/>])[^<>]*>/g)){
  if(++contagem.elementos>100000)throw erro();
  const nome=tag[1].split(':').at(-1);
  if(nome==='row'){if(++linhas>10000)throw erro();numero(atributo(tag[0],'r'),10000);}
  if(nome==='c'){if(++celulas>100000)throw erro();const r=atributo(tag[0],'r');if(!r)throw erro();celula(r);}
  if(nome==='dimension'||nome==='mergeCell'){
   const ref=atributo(tag[0],'ref');if(!ref)throw erro();
   const partes=ref.split(':');if(partes.length>2)throw erro();for(const p of partes)celula(p);
  }
  if(nome==='col'){numero(atributo(tag[0],'min'),256);numero(atributo(tag[0],'max'),256);}
  if(nome==='definedName'){
   // Workbook.definedNames cria uma célula por posição, antes das worksheets.
   // Aceitar somente intervalos canônicos limitados, inclusive soma das áreas.
   definedName.lastIndex=tag.index;
   const definido=definedName.exec(xml);
   if(!definido)throw erro();
   const texto=definido[1].replace(/&(amp|apos|quot|lt|gt);/g,(_,s:string)=>({amp:'&',apos:"'",quot:'"',lt:'<',gt:'>'}[s]!));
   for(const range of texto.split(',')){
    if(!/^(?:'(?:[^'&<>]|'')+'|[\w .-]+)!\$?[A-Z]{1,3}\$?[1-9]\d{0,4}(?::\$?[A-Z]{1,3}\$?[1-9]\d{0,4})?$/.test(range))throw erro();
    const refs=range.slice(range.lastIndexOf('!')+1).replace(/\$/g,'').split(':');
    const a=celula(refs[0]),b=celula(refs[1]??refs[0]);
    contagem.referencias+=(Math.abs(a.col-b.col)+1)*(Math.abs(a.linha-b.linha)+1);
    if(contagem.referencias>100000)throw erro();
   }
  }
 }
}

/** Canonicalizar em STORE impede que outro parser volte a inflar dados hostis. */
function zipStore(entradas:Entrada[]):Uint8Array {
 const tamanho=entradas.reduce((n,e)=>n+30+46+encoder.encode(e.nome).length*2+e.bytes.length,22);
 const out=new Uint8Array(tamanho),view=new DataView(out.buffer);let p=0;
 const indices:{e:Entrada;nome:Uint8Array;offset:number}[]=[];
 for(const e of entradas){
  const nome=encoder.encode(e.nome);indices.push({e,nome,offset:p});
  view.setUint32(p,0x04034b50,true);view.setUint16(p+4,20,true);view.setUint16(p+6,0x800,true);
  view.setUint32(p+14,e.crc,true);view.setUint32(p+18,e.bytes.length,true);view.setUint32(p+22,e.bytes.length,true);view.setUint16(p+26,nome.length,true);
  out.set(nome,p+30);out.set(e.bytes,p+30+nome.length);p+=30+nome.length+e.bytes.length;
 }
 const inicio=p;
 for(const {e,nome,offset} of indices){
  view.setUint32(p,0x02014b50,true);view.setUint16(p+4,20,true);view.setUint16(p+6,20,true);view.setUint16(p+8,0x800,true);
  view.setUint32(p+16,e.crc,true);view.setUint32(p+20,e.bytes.length,true);view.setUint32(p+24,e.bytes.length,true);view.setUint16(p+28,nome.length,true);view.setUint32(p+42,offset,true);
  out.set(nome,p+46);p+=46+nome.length;
 }
 view.setUint32(p,0x06054b50,true);view.setUint16(p+8,entradas.length,true);view.setUint16(p+10,entradas.length,true);view.setUint32(p+12,p-inicio,true);view.setUint32(p+16,inicio,true);
 return out;
}

export async function prepararXlsxSeguro(bytes:Uint8Array):Promise<Uint8Array> {
 if(bytes.length<22||bytes.length>MAX_ARQUIVO)throw erro();
 const v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
 const cabe=(p:number,n:number)=>{if(p<0||p+n>bytes.length)throw erro();};
 const u16=(p:number)=>{cabe(p,2);return v.getUint16(p,true);};
 const u32=(p:number)=>{cabe(p,4);return v.getUint32(p,true);};
 let fim=-1;
 for(let p=bytes.length-22;p>=Math.max(0,bytes.length-65557);p--){
  if(u32(p)===0x06054b50&&p+22+u16(p+20)===bytes.length){fim=p;break;}
 }
 if(fim<0||u16(fim+4)!==0||u16(fim+6)!==0)throw erro();
 const quantidade=u16(fim+10),tamCentral=u32(fim+12),inicio=u32(fim+16);
 if(!quantidade||quantidade>MAX_ENTRADAS||u16(fim+8)!==quantidade||inicio+tamCentral!==fim)throw erro();
 let p=inicio,total=0;const nomes=new Set<string>(),intervalos:{inicio:number;fim:number}[]=[],entradas:Entrada[]=[];const contagem={elementos:0,referencias:0};
 for(let i=0;i<quantidade;i++){
  cabe(p,46);if(u32(p)!==0x02014b50)throw erro();
  const flags=u16(p+8),metodo=u16(p+10),crc=u32(p+16),compactado=u32(p+20),declarado=u32(p+24);
  const nn=u16(p+28),extra=u16(p+30),comentario=u16(p+32),local=u32(p+42);
  if(u16(p+34)!==0||(flags&~0x80e)!==0||(metodo!==0&&metodo!==8)||declarado>MAX_ENTRADA||compactado===0xffffffff||local===0xffffffff||!nn||nn>512)throw erro();
  cabe(p+46,nn+extra+comentario);if(p+46+nn+extra+comentario>fim)throw erro();
  const nome=decoder.decode(bytes.subarray(p+46,p+46+nn));
  const chave=nome.toLowerCase();
  if(!/^[\w[\] .@()+\-/]+$/.test(nome)||nome.startsWith('/')||nome.includes('//')||nome.split('/').some(s=>s==='.'||s==='..')||nomes.has(chave))throw erro();nomes.add(chave);
  // ZIP64 e nomes alternativos por campos extras não entram no ZIP canônico.
  let ep=p+46+nn;const ef=ep+extra;
  while(ep<ef){if(ep+4>ef)throw erro();const id=u16(ep),n=u16(ep+2);if(id===1||id===0x7075||ep+4+n>ef)throw erro();ep+=4+n;}
  cabe(local,30);if(local>=inicio||u32(local)!==0x04034b50||u16(local+6)!==flags||u16(local+8)!==metodo||u16(local+26)!==nn)throw erro();
  const inicioDados=local+30+nn+u16(local+28);const fimDados=inicioDados+compactado;
  cabe(local+30,nn);if(decoder.decode(bytes.subarray(local+30,local+30+nn))!==nome||fimDados>inicio)throw erro();
  // Sem descriptor, o cabeçalho local precisa concordar com o diretório.
  if(!(flags&8)&&(u32(local+14)!==crc||u32(local+18)!==compactado||u32(local+22)!==declarado))throw erro();
  intervalos.push({inicio:local,fim:fimDados});
  const dados=await expandir(bytes.subarray(inicioDados,fimDados),metodo,Math.min(MAX_ENTRADA,MAX_TOTAL-total));
  total+=dados.length;if(dados.length!==declarado)throw erro();
  if(crc32(dados)!==crc)throw new Error('Falha de integridade CRC na planilha. Exporte o arquivo novamente.');
  if(/\.(xml|rels)$/i.test(nome))validarXml(dados,contagem);
  entradas.push({nome,bytes:dados,crc});p+=46+nn+extra+comentario;
 }
 if(p!==fim)throw erro();intervalos.sort((a,b)=>a.inicio-b.inicio);
 for(let i=1;i<intervalos.length;i++)if(intervalos[i].inicio<intervalos[i-1].fim)throw erro();
 return zipStore(entradas);
}
