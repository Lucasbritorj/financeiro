import { normalizarData, type LinhaImportacao } from './csv.ts';
import { paraCentavosAssinado } from './money.ts';

export type TipoLinhaFatura = 'GASTO' | 'PARCELA' | 'ASSINATURA' | 'INFORMATIVO' | 'AJUSTE';
export type LinhaFatura = {
  data_confirmada?: boolean; valor_previsto?: number; previsao_original?: string;
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
  } else if (/\b(netflix|spotify|amazon prime|disney|hbo|max\.com|youtube premium|icloud|adobe)\b|\b(?:microsoft\s*365|smiles\s+clube|anthropic\s*\*?\s*claude|apple\.com\/bills?)/i.test(l.descricao)) {
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
  const vencimentos=textos.flatMap((t,i)=>{
    const m=t.match(/\bvencimento\s*:\s*(\d{2}\/\d{2}\/\d{4})/i)
      ?? (/^vencimento\s*:?$/i.test(t.trim()) ? textos[i+1]?.trim().match(/^(\d{2}\/\d{2}\/\d{4})$/) : null);
    return m ? [normalizarData(m[1])].filter((d):d is string=>!!d) : [];
  });
  if(vencimentos.some(d=>d.slice(0,7)!==competencia))throw new Error('O mês selecionado não corresponde ao vencimento da fatura no PDF.');
  const referencia=vencimentos[0]??competencia+'-01';
  const secoesExplicitas=textos.some(t=>/^lan[cç]amentos:\s*compras e saques/i.test(t.trim()));
  let secao:'ATUAL'|'FUTURA'|'PAGAMENTO'|'RESUMO'=secoesExplicitas?'RESUMO':'ATUAL';
  const linhas: LinhaFatura[] = []; let descartadas = 0; let total_informado: number | null = null;
  for (let i=0;i<textos.length;i++) {
    let texto=textos[i].trim().replace(/\s+/g,' ');
    if(texto==='[[PAGINA]]'){if(secoesExplicitas)secao='RESUMO';continue;}
    if (texto.length>2000) { descartadas++; continue; }
    if(/^compras parceladas\s*[-–]?\s*pr[oó]ximas faturas/i.test(texto)){secao='FUTURA';continue;}
    if(/^lan[cç]amentos(?::\s*compras e saques| internacionais)/i.test(texto)){secao='ATUAL';continue;}
    if(/^pagamentos efetuados/i.test(texto)){secao='PAGAMENTO';continue;}
    if(/^(?:limites de cr[eé]dito|encargos cobrados|novo teto|fique atento|simula[cç][aã]o|oferta|pague sua fatura|pr[oó]xima fatura|demais faturas|total para pr[oó]ximas)/i.test(texto)){secao='RESUMO';continue;}
    const total=texto.match(/\btotal (?:(?:da|desta) fatura(?!\s+anterior)|dos lan[cç]amentos atuais)\s*:?(.*)/i);
    if (total) {
      const v=total[1].match(VALOR);
      if(v){const valor=Math.abs(paraCentavosAssinado(v[0].replace(/[DC]\s*$/i,''))??0);
        if(total_informado!==null&&total_informado!==valor)throw new Error('O PDF contém totais de fatura diferentes. Separe os cartões ou confira o documento.');
        total_informado=valor;}
      continue;
    }
    if(secao==='RESUMO')continue;
    if(secao==='ATUAL' && /^repasse de iof em r\$/i.test(texto)){
      const v=texto.match(VALOR);const valor=v?paraCentavosAssinado(v[0]):null;
      if(valor===null||valor<0){descartadas++;continue;}
      if(valor>0){const l=analisarLinhaFatura({data:referencia,descricao:'IOF de compra internacional',valor});
        l.original=texto;l.data_confirmada=false;l.motivo='Encargo da fatura; data de referência do vencimento (ou competência), não data da compra. Confira.';linhas.push(l);}
      continue;
    }
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
    const descricao=texto.slice(d[0].length, v.index).trim();
    const valor=paraCentavosAssinado(v[0].replace(/[DC]\s*$/i,''));
    // A parcela limita o ano mais recente possível; ainda é uma sugestão que
    // precisa de confirmação, pois o documento não informa o ano da compra.
    const sugestao=analisarLinhaFatura({data:referencia,valor:valor??0,descricao});
    // Um mês de tolerância entre compra e primeira cobrança evita deslocar
    // um ano inteiro quando o fechamento/vencimento atravessa o mês.
    const limite=new Date(Date.UTC(ano,mes-1-(sugestao.tipo==='PARCELA'?Math.max(0,sugestao.parcela_numero-2):0),1));
    const anoCompra=limite.getUTCFullYear()-(Number(token.slice(3,5))>limite.getUTCMonth()+1?1:0);
    const data=token.length===5 ? normalizarData(`${token}/${anoCompra}`) : normalizarData(token);
    if (!data || !descricao || !valor) { descartadas++; continue; }
    const linha=analisarLinhaFatura({data,valor,descricao});
    if(token.length===5){linha.data_confirmada=false;linha.motivo+=' Ano sugerido pelo mês da fatura e parcela; confira a data.';}
    if ((valor<0 || /C\s*$/i.test(v[0])) && linha.tipo!=='INFORMATIVO') {
      linha.tipo='AJUSTE'; linha.motivo='Crédito/estorno: exclua esta linha ou trate o ajuste antes de importar.';
    }
    if(secao==='FUTURA'){linha.tipo='INFORMATIVO';linha.ignorar=true;linha.motivo='Parcela da seção próximas faturas: somente previsão, não é cobrança atual.';}
    if(secao==='PAGAMENTO'){linha.tipo='INFORMATIVO';linha.ignorar=true;linha.motivo='Pagamento anterior: não é novo gasto.';}
    linha.original=texto; linhas.push(linha);
  }
  const base=(s:string)=>s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/\s+(?:parcela\s*)?\d{1,3}\s*(?:\/|de)\s*\d{1,3}\s*$/i,'').toLowerCase().replace(/\s+/g,' ').trim();
  for(const atual of linhas.filter(l=>l.tipo==='PARCELA')){
    const atuais=linhas.filter(l=>l.tipo==='PARCELA'&&base(l.descricao)===base(atual.descricao)&&l.data.slice(5)===atual.data.slice(5)&&l.parcela_numero===atual.parcela_numero&&l.parcelas_total===atual.parcelas_total);
    const futuras=linhas.filter(l=>l.tipo==='INFORMATIVO'&&l.motivo.startsWith('Parcela da seção')&&base(l.descricao)===base(atual.descricao)&&l.data.slice(5)===atual.data.slice(5)&&l.parcela_numero===atual.parcela_numero+1&&l.parcelas_total===atual.parcelas_total);
    if(atuais.length===1&&futuras.length===1){atual.valor_previsto=futuras[0].valor;atual.previsao_original=futuras[0].original;}
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
    if(l.valor_previsto!==undefined&&(!Number.isSafeInteger(l.valor_previsto)||l.valor_previsto<1||l.valor_previsto>999999999999))return 'Valor previsto inválido em centavos.';
    if(l.natureza_valor==='CREDITO')return 'Crédito/estorno não pode ser importado como compra.';
    if(!l.sinal_confirmado)return 'Confira o sinal da linha: confirme se é despesa do cartão.';
    if(l.tipo==='AJUSTE') return 'Crédito/estorno não pode ser importado como compra. Exclua a linha explicitamente.';
    if(l.tipo==='INFORMATIVO') return 'Pagamento/total não pode ser importado como compra.';
    if(l.data_confirmada===false)return 'Confira e confirme as datas sugeridas antes de importar.';
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
    if(l.tipo==='PARCELA'&&!l.plano_id) r.previsoes+=(l.valor_previsto??l.valor)*Math.max(0,l.parcelas_total-l.parcela_numero);
    if(l.tipo==='ASSINATURA'&&l.decisao_assinatura==='PENDENTE') r.pendentes++;
    return r;
  },{cobrancas:0,previsoes:0,ajustes:0,pendentes:0,ignoradas:0});
}
