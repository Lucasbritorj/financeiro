import { execFileSync, spawnSync } from "node:child_process";
import {randomBytes} from 'node:crypto';

// Chaves obtidas apenas da instância local, nunca de arquivo .env ou projeto remoto.
const windows = process.platform === "win32";
const contextoLocal=process.env.E2E_SUPABASE_ALTERNATIVO==='1'?['--workdir','.work/tooling/receitas-stack']:[];
const status = JSON.parse(execFileSync(windows ? "supabase.cmd" : "supabase", [...contextoLocal,"status", "-o", "json"], { encoding: "utf8", shell: windows, stdio: ["ignore", "pipe", "ignore"] }));
if (!['http://127.0.0.1:54321','http://127.0.0.1:25321'].includes(new URL(status.API_URL).origin)) throw new Error("Inicie uma das instâncias locais exclusivas deste projeto.");
const chaveRpc=randomBytes(32).toString('hex');
const configurada=await fetch(status.API_URL+'/rest/v1/rpc/configurar_chave_rpc_servidor',{method:'POST',headers:{apikey:status.SERVICE_ROLE_KEY,authorization:'Bearer '+status.SERVICE_ROLE_KEY,'content-type':'application/json'},body:JSON.stringify({p_chave:chaveRpc})});
if(!configurada.ok)throw new Error('Falha configurando assinatura da instância local.');
const env = { ...process.env, FINANCEIRO_RPC_SIGNING_KEY:chaveRpc, NEXT_PUBLIC_SUPABASE_URL: status.API_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY: status.ANON_KEY,
  SUPABASE_SERVICE_ROLE_KEY: status.SERVICE_ROLE_KEY, E2E_LOCAL_SERVICE_ROLE: status.SERVICE_ROLE_KEY, E2E_LOCAL_MAIL_URL:status.MAILPIT_URL??status.INBUCKET_URL, E2E_LOCAL: "1", E2E_PORT: "3100" };
if(process.env.GITHUB_ACTIONS==='true') {
  // Apenas credenciais da instância descartável; os valores não aparecem nos logs do job.
  for(const segredo of [status.ANON_KEY,status.SERVICE_ROLE_KEY,chaveRpc]) if(segredo)process.stdout.write(`::add-mask::${segredo}\n`);
}
function executar(comando, args) {
  const result = spawnSync(comando, args, { env, stdio: "inherit", shell: windows && comando !== process.execPath });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
executar(windows ? "npm.cmd" : "npm", ["run", "build"]);
executar(process.execPath, ["node_modules/@playwright/test/cli.js", "test", "--project=desktop-1440", "--project=mobile-320", "--workers=1", ...process.argv.slice(2)]);
