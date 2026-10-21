/** Fronteira HTTP: sessão só no servidor e corpos limitados antes do parse. */
export function opcoesCookieSessao(producao = process.env.NODE_ENV === 'production') {
 return {httpOnly:true,secure:producao,sameSite:'lax' as const,path:'/'};
}
export function origemPublica(request:Request):string {
 const url=new URL(request.url);const host=request.headers.get('host')??url.host;
 if(/[\s/@\\?#]/.test(host))throw new Error('Host inválido.');
 // Next pode construir request.url com hostname interno; Host vem do roteador HTTP.
 // Na Vercel, o roteador só entrega hosts vinculados ao projeto e o tráfego é HTTPS.
 return new URL((process.env.VERCEL==='1'?'https:':url.protocol)+'//'+host).origin;
}
export function origemPermitida(request: Request): boolean {
 try{return request.headers.get('origin')===origemPublica(request);}catch{return false;}
}
export function caminhoDadosPermitido(caminho:string):boolean {
 return /^(?:rpc\/)?[a-z][a-z0-9_]{0,99}$/.test(caminho);
}
export async function lerJsonLimitado(request:Request,limite:number):Promise<Record<string,unknown>> {
 const declarado=request.headers.get('content-length');
 if(declarado&&(!/^\d+$/.test(declarado)||Number(declarado)>limite))throw new Error('Corpo inválido.');
 const leitor=request.body?.getReader();if(!leitor)throw new Error('Corpo ausente.');
 let bytes=0;const blocos:Uint8Array[]=[];
 try{for(;;){const {done,value}=await leitor.read();if(done)break;bytes+=value.byteLength;if(bytes>limite)throw new Error('Corpo acima do limite.');blocos.push(value);}}
 catch(e){await leitor.cancel().catch(()=>{});throw e;}
 finally{leitor.releaseLock();}
 const tudo=new Uint8Array(bytes);let offset=0;for(const b of blocos){tudo.set(b,offset);offset+=b.length;}
 const resultado:unknown=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(tudo));
 if(!resultado||typeof resultado!=='object'||Array.isArray(resultado))throw new Error('Objeto JSON obrigatório.');
 return resultado as Record<string,unknown>;
}
