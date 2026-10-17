"use client";
import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { mensagemDeErro } from '@/lib/erros';
import { lerTodasPaginas } from '@/lib/leitura-paginada';
import { validarTamanhoArquivoImportacao } from '@/lib/csv';
import { lerArquivoFatura, sha256DoArquivo } from '@/lib/leitura-arquivo';
import { extensaoDoArquivo, origemPorExtensao, type OrigemImportacao } from '@/lib/importacao-preview';
import { validarLinhasFatura, type LinhaFatura, type PlanoParcelamento } from '@/lib/importacao-fatura';
import type { Database, Json } from '@/lib/database.types';

type Cobranca = Database['public']['Tables']['cobrancas_importadas']['Row'];
export type ContratoFatura = {id:string;descricao:string;cartao_id:string|null};
export type RevisaoFatura = {chave:string;sha:string|null;origem:OrigemImportacao;cartaoId:string;competencia:string;linhas:LinhaFatura[];descartadas:number;total_extraido:number|null;total_informado:number|null};
const normalizar=(s:string)=>s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\s+/g,' ').trim();
async function carregarContexto(cartaoId:string) {
 const db=createClient();
 const [planos,contratos,cobrancas]=await Promise.all([
  lerTodasPaginas<PlanoParcelamento>( (id,n)=>{
   let q=db.from('planos_parcelamento').select('*').eq('cartao_id',cartaoId);if(id)q=q.gt('id',id);return q.order('id').limit(n);
  }),
  lerTodasPaginas<ContratoFatura>((id,n)=>{
   let q=db.from('recorrencias').select('id,descricao,cartao_id').eq('cartao_id',cartaoId).eq('finalidade','ASSINATURA').eq('status','ATIVA');if(id)q=q.gt('id',id);return q.order('id').limit(n);
  }),
  lerTodasPaginas<Cobranca>((id,n)=>{
   let q=db.from('cobrancas_importadas').select('*').eq('cartao_id',cartaoId);if(id)q=q.gt('id',id);return q.order('id').limit(n);
  }),
 ]);
 return {planos,contratos,cobrancas};
}
export function useImportacaoFatura() {
 const router=useRouter(); const enviando=useRef(false);
 const [cartaoId,setCartaoId]=useState('');const [competencia,setCompetencia]=useState('');
 const [revisao,setRevisao]=useState<RevisaoFatura|null>(null);
 const [planos,setPlanos]=useState<PlanoParcelamento[]>([]);const [contratos,setContratos]=useState<ContratoFatura[]>([]);
 const [cobrancas,setCobrancas]=useState<Cobranca[]>([]);
 const [pendente,setPendente]=useState(false);const [erro,setErro]=useState<string|null>(null);const [aviso,setAviso]=useState<string|null>(null);
 const [conferido,setConferido]=useState(false);
 async function processar(arquivo:File) {
  if(enviando.current)return;setErro(null);setAviso(null);
  if(!cartaoId||!/^\d{4}-(0[1-9]|1[0-2])$/.test(competencia)) {setErro('Selecione o cartão e o mês da fatura.');return;}
  const erroTamanho=validarTamanhoArquivoImportacao(arquivo.size);if(erroTamanho){setErro(erroTamanho);return;}
  const ext=extensaoDoArquivo(arquivo.name);if(!['pdf','csv','ofx','ofc','xlsx'].includes(ext)){setErro('Formato não suportado. Use PDF, CSV, OFX/OFC ou XLSX.');return;}
  enviando.current=true;setPendente(true);
  try {
   const origem=origemPorExtensao(ext);
   const [resultado,contexto,sha]=await Promise.all([lerArquivoFatura(arquivo,origem,competencia),carregarContexto(cartaoId),sha256DoArquivo(arquivo)]);
   if(resultado.linhas.length>1000)throw new Error('Divida a fatura em lotes de até 1000 linhas.');
   const linhas=resultado.linhas.map(l=>{
    const anteriores=contexto.cobrancas.filter(c=>normalizar(c.descricao)===normalizar(l.descricao));
    const meses=new Set(anteriores.filter(c=>c.competencia!==competencia+'-01').map(c=>c.competencia));
    if(l.tipo==='GASTO'&&meses.size>=2)l={...l,tipo:'ASSINATURA',motivo:'Descrição já apareceu em dois outros meses; confirme a possível assinatura.'};
    const semelhante=contexto.cobrancas.some(c=>c.competencia===competencia+'-01'&&c.data===l.data&&c.valor===l.valor);
    if(semelhante)l={...l,ignorar:true,motivo:l.motivo+' Cobrança de mesma data e valor já registrada; mantenha excluída ou confirme como nova.'};
    return l;
   });
   setPlanos(contexto.planos);setContratos(contexto.contratos);setCobrancas(contexto.cobrancas);setConferido(false);
   setRevisao({chave:crypto.randomUUID(),sha,origem,cartaoId,competencia,linhas,descartadas:resultado.descartadas,total_extraido:resultado.total_informado,total_informado:resultado.total_informado});
  }catch(e){setErro(mensagemDeErro(e));}finally{enviando.current=false;setPendente(false);}
 }
 function alterar(index:number,patch:Partial<LinhaFatura>) {
  setErro(null);setConferido(false);
  setRevisao(r=>r?{...r,chave:crypto.randomUUID(),linhas:r.linhas.map((l,i)=>i===index?{...l,...patch,...(patch.data!==undefined&&patch.data!==l.data?{data_confirmada:false}:{})}:l)}:r);
 }
 function confirmarDatas() {
  if(enviando.current)return;
  setErro(null);
  setRevisao(r=>r?{...r,chave:crypto.randomUUID(),linhas:r.linhas.map(l=>!l.ignorar&&l.tipo!=='INFORMATIVO'&&l.tipo!=='AJUSTE'&&l.data_confirmada===false?{...l,data_confirmada:true}:l)}:r);
 }
 function alterarTotal(total:number|null) {
  if(revisao?.origem==='PDF'&&revisao.total_extraido!==null){setErro('O total extraído do PDF não pode ser alterado. Confira as cobranças selecionadas.');return;}
  if(total===revisao?.total_informado)return;
  setConferido(false);setRevisao(r=>r?{...r,chave:crypto.randomUUID(),total_informado:total}:r);
 }
 async function confirmar() {
  if(!revisao||enviando.current)return;
  const validacao=validarLinhasFatura(revisao.linhas);if(validacao){setErro(validacao);return;}
  const ativas=revisao.linhas.filter(l=>!l.ignorar);
  if(!ativas.length){setErro('Selecione ao menos uma cobrança.');return;}
  const total=ativas.reduce((s,l)=>s+l.valor,0);
  const totalConferencia=revisao.origem==='PDF'?revisao.total_extraido??revisao.total_informado:revisao.total_informado;
  if(revisao.origem==='PDF'&&totalConferencia!==null&&total!==totalConferencia){setErro('O total selecionado difere da fatura. Corrija os valores ou a seleção antes de confirmar.');return;}
  if((revisao.descartadas>0||(revisao.total_informado!==null&&total!==revisao.total_informado))&&!conferido){setErro('Revise as linhas descartadas ou a diferença de total e confirme a conferência.');return;}
  enviando.current=true;setPendente(true);setErro(null);
  try {
   const {data,error}=await createClient().rpc('confirmar_fatura_importada',{
    p_chave:revisao.chave,p_sha:revisao.sha,p_cartao_id:revisao.cartaoId,p_competencia:revisao.competencia+'-01',p_origem:revisao.origem,
    p_linhas:JSON.parse(JSON.stringify(revisao.linhas)) as Json,p_total:totalConferencia,p_conferido:conferido,
   }).abortSignal(AbortSignal.timeout(20000));
   if(error)throw error;
   const res=data as {criadas:number;duplicadas:number;repetida:boolean};
   setAviso(res.repetida?'Esse lote já foi confirmado. Nenhuma cobrança duplicada.':`${res.criadas} cobrança(s) registrada(s); ${res.duplicadas} duplicada(s) ignorada(s).`);
   setRevisao(null);router.refresh();
  }catch(e){setErro(mensagemDeErro(e));}finally{enviando.current=false;setPendente(false);}
 }
 return {cartaoId,setCartaoId,competencia,setCompetencia,revisao,planos,contratos,cobrancas,pendente,erro,aviso,conferido,setConferido,processar,alterar,alterarTotal,confirmarDatas,confirmar,
  descartar:()=>{setRevisao(null);setErro(null);}};
}
