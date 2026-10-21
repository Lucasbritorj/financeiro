import {log} from './log';
/** Vocabulário fechado: nunca registrar payload, URL, e-mail, token ou erro bruto. */
export type EventoSeguranca = 'login_recusado'|'logout_recusado'|'senha_alterada'|'origem_recusada'|'limite_excedido'|'dependencia_indisponivel';
export function registrarEvento(evento:EventoSeguranca,operacao:string):void {
 log.erro(JSON.stringify({tipo:'seguranca',evento,operacao:operacao.replace(/[^a-z_]/g,'').slice(0,40),data:new Date().toISOString()}));
}
