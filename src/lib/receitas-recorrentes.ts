export type ParteReceita={dia:number;valor:number};
export function validarPartes(partes:ParteReceita[]){
 if(partes.length<1||partes.length>31||new Set(partes.map(p=>p.dia)).size!==partes.length)throw new Error('Informe dias distintos para cada parte da receita.');
 for(const p of partes)if(!Number.isInteger(p.dia)||p.dia<1||p.dia>31||!Number.isSafeInteger(p.valor)||p.valor<1||p.valor>999999999999)throw new Error('Informe dia de 1 a 31 e valor positivo para cada parte.');
}
export function dataDaParte(mes:string,dia:number){
 if(!/^20\d{2}-(0[1-9]|1[0-2])$/.test(mes)||!Number.isInteger(dia)||dia<1||dia>31)throw new Error('Mês ou dia inválido.');
 const [ano,m]=mes.split('-').map(Number);const ultimo=new Date(Date.UTC(ano,m,0)).getUTCDate();
 return `${mes}-${String(Math.min(dia,ultimo)).padStart(2,'0')}`;
}
export type OcorrenciaReceita={id:string;recorrencia_id:string;descricao:string;valor:number;data_prevista:string;status:'PREVISTA'|'RECEBIDA'|'PULADA';transacao_id:string|null;motivo:string|null};
