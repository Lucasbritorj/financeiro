export function validarReceita(forma:string,valor:number,data:string,observacao:string) {
 if(!['PIX','TRANSFERENCIA','DINHEIRO'].includes(forma))throw new Error('Receita deve ser recebida por Pix, transferência ou dinheiro.');
 if(!Number.isSafeInteger(valor)||valor<=0)throw new Error('Informe um valor positivo válido.');
 if(!/^20\d{2}-\d{2}-\d{2}$/.test(data)||!Number.isFinite(Date.parse(data))||new Date(data).toISOString().slice(0,10)!==data)throw new Error('Data de recebimento inválida.');
 if(observacao.length>2000)throw new Error('A observação deve ter até 2000 caracteres.');
}
