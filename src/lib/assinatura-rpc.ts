import {createHmac} from 'node:crypto';
/** Uso exclusivo no transporte servidor; a chave nunca vai para o navegador. */
export const RPCS_PROTEGIDAS=new Set(['criar_importacao','confirmar_importacao','confirmar_fatura_importada','importar_extrato_conta','salvar_regra_pessoal']);
export function gerarAssinaturaRpc(chave:string|undefined,usuario:string,rpc:string,tempo=Math.floor(Date.now()/1000)){
 if(!chave||!/^([a-f0-9]{64})$/.test(chave)||!RPCS_PROTEGIDAS.has(rpc)||!Number.isSafeInteger(tempo))throw new Error('Assinatura de servidor indisponível.');
 return {'x-financeiro-tempo':String(tempo),'x-financeiro-assinatura':createHmac('sha256',Buffer.from(chave,'hex')).update(tempo+'|'+usuario+'|'+rpc).digest('hex')};
}
