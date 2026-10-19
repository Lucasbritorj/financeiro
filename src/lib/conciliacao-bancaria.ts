export type ContaBancaria = {id:string;nome:string;saldo_inicial:number;data_inicial:string;fechado_ate:string|null;saldo_fechado:number|null};
export type LinhaBancaria = {id:string;data:string;descricao:string;valor:number;movimento_id:string|null;ignorada:boolean;ambigua:boolean;origem:string};
export type MovimentoConta = {id:string;data:string;descricao:string;valor:number;transferencia_id:string|null;transacao_id:string|null};
export type CandidatoBancario = {id:string;data_compra:string;descricao:string;valor_total:number;tipo:string;natureza:string};
export type DetalheConta = {conta:ContaBancaria;saldo:number;linhas:LinhaBancaria[];movimentos:MovimentoConta[];candidatos:CandidatoBancario[];faturas:{id:string;descricao:string;valor:number;data:string}[];historico:{evento:string;created_at:string;detalhes:unknown}[]};

/** Sugere candidatos; a escolha é sempre explícita, inclusive se houver apenas um. */
export function candidatosParaLinha(linha:Pick<LinhaBancaria,'valor'|'data'>, candidatos:CandidatoBancario[]) {
 return candidatos.filter(t=>t.valor_total===Math.abs(linha.valor)&&t.tipo===(linha.valor<0?'DESPESA':'RECEITA')&&Math.abs(Date.parse(t.data_compra)-Date.parse(linha.data))<=3*86400000);
}
