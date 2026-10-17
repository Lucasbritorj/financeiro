import { normalizarData, type LinhaImportacao } from './csv.ts';
import { paraCentavosAssinado } from './money.ts';

export type TipoLinhaFatura = 'GASTO' | 'PARCELA' | 'ASSINATURA' | 'INFORMATIVO' | 'AJUSTE';
export type LinhaFatura = {
  natureza_valor?: LinhaImportacao['natureza_valor']; sinal_confirmado: boolean;
  data: string; descricao: string; valor: number; original: string; motivo: string;
  tipo: TipoLinhaFatura; ignorar: boolean; categoria_id: string | null;
  parcela_numero: number; parcelas_total: number; plano_id: string | null;
  decisao_assinatura: 'PENDENTE' | 'NOVA' | 'VINCULAR' | 'NAO';
  assinatura_id: string | null; periodicidade: 'MENSAL' | 'TRIMESTRAL' | 'SEMESTRAL' | 'ANUAL';
  proxima_cobranca: string; decisao_duplicidade: 'PENDENTE' | 'NOVA';
  id_externo?: string;
};
export type PlanoParcelamento = {
  id: string; competencia_base: string; parcela_base: number; parcelas_total: number;
  valor_previsto: number; descricao?: string; cartao_id?: string;
};
export function analisarLinhaFatura(l: LinhaImportacao): LinhaFatura {
  let tipo: TipoLinhaFatura = 'GASTO';
  let motivo = 'Compra sem indicação de parcelamento ou assinatura.';
  let numero = 1; let total = 1;
  const parcela = l.descricao.match(/\bparcela\s*(\d{1,3})\s*(?:de|\/)\s*(\d{1,3})\b/i)
    ?? (!/\b(pedido|documento|codigo|código)\b/i.test(l.descricao)
      ? l.descricao.match(/\s(\d{1,3})\/(\d{1,3})\s*$/) : null);
  if (l.natureza_valor==='CREDITO' || /\b(estorno|cr[eé]dito|cashback|reembolso)\b/i.test(l.descricao)) {
    tipo = 'AJUSTE'; motivo = 'Crédito/estorno: tratamento contábil indisponível; exclua esta linha explicitamente.';
  } else if (/\b(pagamento|total (?:da|desta) fatura|saldo|limite dispon[ií]vel)\b/i.test(l.descricao)) {
    tipo = 'INFORMATIVO'; motivo = 'Pagamento ou resumo não é uma nova compra.';
  } else if (parcela) {
    tipo = 'PARCELA'; numero = Number(parcela[1]); total = Number(parcela[2]);
    motivo = `Indicação de parcela ${numero} de ${total}; confira antes de confirmar.`;
  } else if (/\b(netflix|spotify|amazon prime|disney|hbo|max\.com|youtube premium|icloud|apple\.com\/bill|adobe)\b/i.test(l.descricao)) {
    tipo = 'ASSINATURA'; motivo = 'Fornecedor conhecido de serviços; confirme se é assinatura.';
  }
  return { data:l.data, descricao:l.descricao, valor:Math.abs(l.valor), original:l.descricao,
    natureza_valor:l.natureza_valor,sinal_confirmado:l.natureza_valor!=='DESCONHECIDA',
    id_externo:l.id_externo, tipo, motivo, ignorar:tipo==='INFORMATIVO', categoria_id:null,
    parcela_numero:numero, parcelas_total:total, plano_id:null,
    decisao_assinatura:'PENDENTE', assinatura_id:null, periodicidade:'MENSAL',proxima_cobranca:'',
    decisao_duplicidade:'PENDENTE' };
}

const VALOR = /(?<![\d.,])-?(?:R\$\s*)?(?:\d{1,3}(?:\.\d{3})*|\d{1,9}),\d{2}(?:\s*[DC])?\s*$/i;
const DATA = /^(\d{2}\/\d{2}(?:\/\d{4})?|\d{4}-\d{2}-\d{2})\s+/;
export function parsePdfFatura(textos: string[], competencia: string) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(competencia)) throw new Error('Informe o mês de competência da fatura.');
  if (!textos.some(x=>x.trim())) throw new Error('PDF sem texto. PDF digitalizado requer OCR e não é suportado.');
  const finais=new Set(textos.flatMap(t=>[...t.matchAll(/cart[aã]o\s+(?:de cr[eé]dito\s+)?(?:final|terminado em)\s*:?[ *]*(\d{4})/gi)].map(m=>m[1])));
  if(finais.size>1)throw new Error('Este PDF contém cartões diferentes. Separe as faturas por cartão antes de importar.');
  const [ano,mes] = competencia.split('-').map(Number);
  const linhas: LinhaFatura[] = []; let descartadas = 0; let total_informado: number | null = null;
  for (let i=0;i<textos.length;i++) {
    let texto=textos[i].trim().replace(/\s+/g,' ');
    if (texto.length>2000) { descartadas++; continue; }
    const total=texto.match(/\btotal (?:da|desta) fatura\s*:?(.*)/i);
    if (total) { const v=total[1].match(VALOR); if(v) total_informado=Math.abs(paraCentavosAssinado(v[0].replace(/[DC]\s*$/i,'')) ?? 0); continue; }
    const d=texto.match(DATA); if (!d) continue;
    if ((texto.match(/\b\d{2}\/\d{2}(?:\/\d{4})?\s+[a-zÀ-ÿ]/gi)??[]).length>1) {descartadas++;continue;}
    const continuacao = textos[i+1]?.trim() ?? '';
    const parcelaQuebrada = /^\d{1,3}\/\d{1,3}\s+-?[\d.,]+$/.test(continuacao);
    if (!texto.match(VALOR) && i+1<textos.length && (!DATA.test(continuacao)||parcelaQuebrada) && continuacao.match(VALOR)) {
      texto+=' '+textos[++i].trim();
    }
    const v=texto.match(VALOR);
    if (!v) { descartadas++; continue; }
    const token=d[1];
    const data=token.length===5 ? normalizarData(`${token}/${Number(token.slice(3))>mes ? ano-1 : ano}`) : normalizarData(token);
    const descricao=texto.slice(d[0].length, v.index).trim();
    const valor=paraCentavosAssinado(v[0].replace(/[DC]\s*$/i,''));
    if (!data || !descricao || !valor) { descartadas++; continue; }
    const linha=analisarLinhaFatura({data,valor,descricao});
    if ((valor<0 || /C\s*$/i.test(v[0])) && linha.tipo!=='INFORMATIVO') {
      linha.tipo='AJUSTE'; linha.motivo='Crédito/estorno: exclua esta linha ou trate o ajuste antes de importar.';
    }
    linha.original=texto; linhas.push(linha);
  }
  if (!linhas.length) throw new Error('Nenhum lançamento reconhecido no PDF. Confira o layout ou use CSV/OFX.');
  return {linhas,descartadas,total_informado};
}

export function preverParcelas(plano: PlanoParcelamento, confirmadas: readonly number[]) {
  const previstas: {plano_id:string; numero:number; competencia:string; valor:number}[]=[];
  const [ano,mes]=plano.competencia_base.split('-').map(Number);
  for(let numero=plano.parcela_base+1;numero<=plano.parcelas_total;numero++) {
    if(confirmadas.includes(numero)) continue;
    const d=new Date(Date.UTC(ano,mes-1+numero-plano.parcela_base,1));
    previstas.push({plano_id:plano.id,numero,competencia:d.toISOString().slice(0,10),valor:plano.valor_previsto});
  }
  return previstas;
}
export function validarLinhasFatura(linhas: readonly LinhaFatura[]): string | null {
  if (!linhas.length || linhas.length>1000) return 'Revise um lote entre 1 e 1000 linhas.';
  for(const l of linhas.filter(x=>!x.ignorar)) {
    if(l.natureza_valor==='CREDITO')return 'Crédito/estorno não pode ser importado como compra.';
    if(!l.sinal_confirmado)return 'Confira o sinal da linha: confirme se é despesa do cartão.';
    if(l.tipo==='AJUSTE') return 'Crédito/estorno não pode ser importado como compra. Exclua a linha explicitamente.';
    if(l.tipo==='INFORMATIVO') return 'Pagamento/total não pode ser importado como compra.';
    if(!Number.isSafeInteger(l.valor)||l.valor<=0||l.valor>999999999999) return 'Valor inválido em centavos.';
    if(!/^\d{4}-\d{2}-\d{2}$/.test(l.data)||!Number.isFinite(Date.parse(l.data))||new Date(l.data).toISOString().slice(0,10)!==l.data) return 'Data inválida.';
    if(!l.descricao.trim()||l.descricao.length>500) return 'Descrição obrigatória, até 500 caracteres.';
    if(l.tipo==='PARCELA'&&(!Number.isInteger(l.parcela_numero)||!Number.isInteger(l.parcelas_total)||l.parcela_numero<1||l.parcelas_total<2||l.parcelas_total>120||l.parcela_numero>l.parcelas_total)) return 'Número ou total de parcelas inválido (máximo 120).';
    if(l.tipo==='ASSINATURA'&&l.decisao_assinatura==='PENDENTE') return 'Confirme se a possível assinatura é um contrato ou gasto comum.';
    if(l.tipo==='ASSINATURA'&&l.decisao_assinatura==='VINCULAR'&&!l.assinatura_id) return 'Escolha a assinatura existente.';
    if(l.tipo==='ASSINATURA'&&l.decisao_assinatura==='NOVA'&&!l.proxima_cobranca) return 'Informe a próxima cobrança da assinatura.';
  }
  return null;
}
export function resumoFatura(linhas: readonly LinhaFatura[]) {
  return linhas.reduce((r,l)=>{
    if(l.ignorar) { r.ignoradas++; return r; }
    if(l.tipo==='AJUSTE') {r.ajustes+=l.valor;r.pendentes++;return r;}
    if(l.tipo==='INFORMATIVO') {r.pendentes++;return r;}
    r.cobrancas+=l.valor;
    if(l.tipo==='PARCELA'&&!l.plano_id) r.previsoes+=l.valor*Math.max(0,l.parcelas_total-l.parcela_numero);
    if(l.tipo==='ASSINATURA'&&l.decisao_assinatura==='PENDENTE') r.pendentes++;
    return r;
  },{cobrancas:0,previsoes:0,ajustes:0,pendentes:0,ignoradas:0});
}
