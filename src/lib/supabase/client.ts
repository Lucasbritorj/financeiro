import {createClient as criarSupabase} from '@supabase/supabase-js';
import type {Database} from '@/lib/database.types';
import {fetchComTimeout} from './fetch';

/** Builders preservados; tokens e autenticação ficam exclusivamente no servidor. */
export function createClient() {
 const cliente=criarSupabase<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,{
  auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},
  global:{fetch:async(input,init)=>{
   const url=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url);
   const base=new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!);
   if(url.origin!==base.origin||!url.pathname.startsWith('/rest/v1/'))throw new Error('Destino não permitido.');
   const headers=new Headers(init?.headers);headers.delete('authorization');headers.delete('apikey');
   return fetchComTimeout('/api/dados/'+url.pathname.slice('/rest/v1/'.length)+url.search,{...init,headers,credentials:'same-origin',cache:'no-store'});
  }},
 });
 async function autenticar(acao:string,campos:Record<string,unknown>={}){
  try{
   const r=await fetchComTimeout('/api/auth',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({acao,...campos}),cache:'no-store'});
   const body=await r.json();
   if(!r.ok)return {data:{user:null,session:null},error:{code:body.code??'FW503',message:body.erro??'Serviço temporariamente indisponível.'}};
   return {data:{user:body.user??null,session:body.autenticado?{}:null},error:null};
  }catch{return {data:{user:null,session:null},error:{code:'FW503',message:'Não foi possível acessar o servidor. Tente novamente.'}};}
 }
 const auth={
  // Contrato explícito: nenhum token existe no browser.
  getSession:async()=>({data:{session:null},error:null}),
  signInWithPassword:(campos:{email:string;password:string})=>autenticar('entrar',campos),
  signUp:(campos:{email:string;password:string})=>autenticar('cadastrar',campos),
  resetPasswordForEmail:(email:string,_opcoes?:{redirectTo?:string})=>autenticar('recuperar',{email}),
  updateUser:(campos:{password:string})=>autenticar('senha',campos),
  signOut:()=>autenticar('sair'),
  getUser:async()=>{
   try{const r=await fetchComTimeout('/api/auth',{credentials:'same-origin',cache:'no-store'});const body=await r.json();return {data:{user:r.ok?body.user:null},error:r.ok?null:{message:'Entre novamente.'}};}
   catch{return {data:{user:null},error:{message:'Não foi possível validar sua sessão.'}};}
  },
 };
 return {from:cliente.from.bind(cliente),rpc:cliente.rpc.bind(cliente),auth};
}
