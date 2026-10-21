import {paraCentavosAssinado} from './money.ts';

export function lerCentavosComZero(valor:string):number|null {
 if (/^[+-]?0+(?:[.,]0{1,2})?$/.test(valor.trim())) return 0;
 return paraCentavosAssinado(valor);
}

export function validarMesOrcamento(mes: string): boolean {
  return /^20\d{2}-(0[1-9]|1[0-2])$/.test(mes);
}

/** undefined herda o padrão; null retira explicitamente o limite só neste mês. */
export function calcularOrcamento(mensal: number | null | undefined, padrao: number | null, gasto: number) {
  const limite = mensal === undefined ? padrao : mensal;
  for (const valor of [limite, gasto]) {
    if (valor !== null && (!Number.isSafeInteger(valor) || valor < 0)) throw new Error('Valor em centavos inválido.');
  }
  return { limite, gasto, disponivel: limite === null ? null : limite - gasto, excedido: limite !== null && gasto > limite };
}
