import 'server-only';
import {createClient} from '@supabase/supabase-js';
import type {Database} from '@/lib/database.types';
import {fetchComTimeout} from './fetch';

/** Exclusivo do servidor: sem cookies, persistência ou sessão do navegador. */
export function clientePrivilegiado() {
 const url=process.env.NEXT_PUBLIC_SUPABASE_URL;
 const chave=process.env.SUPABASE_SERVICE_ROLE_KEY;
 if(!url||!chave)return null;
 return createClient<Database>(url,chave,{
  auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},
  global:{fetch:fetchComTimeout},
 });
}
