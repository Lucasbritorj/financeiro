import {spawnSync} from 'node:child_process';
import {mkdir,readFile,writeFile,unlink} from 'node:fs/promises';
import {resolve,join,win32} from 'node:path';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {criptografarCopia,abrirCopia} from './backup-criptografia.mjs';
import {obterChavesBackup} from './chaves-backup.mjs';

const schemas=['auth','public','storage','supabase_migrations'];
const manifestSql=`begin read only;set local statement_timeout='30s';set local timezone='UTC';
select coalesce(jsonb_agg(jsonb_build_object('schema',schemaname,'tabela',tablename,'verificacao',query_to_xml(format('select count(*) as quantidade,md5(coalesce(string_agg(md5(to_jsonb(x)::text),%L order by md5(to_jsonb(x)::text)),%L)) as hash from %I.%I x','','',schemaname,tablename),false,true,'')::text) order by schemaname,tablename),'[]') as manifest from pg_tables where schemaname in ('auth','public','storage','supabase_migrations') and (schemaname,tablename) not in (('auth','schema_migrations'),('storage','migrations'));commit;`;

export function validarDestinoBackup(entrada) {
 const absoluto=win32.resolve(entrada);const relativo=win32.relative('C:\\Backup',absoluto);
 if(!relativo||relativo.startsWith('..')||win32.isAbsolute(relativo)||/["'`;&|<>\r\n]/.test(absoluto))throw new Error('Use uma subpasta privada de C:\\Backup.');
 return absoluto;
}
export function compararManifestos(antes,depois){assert.deepEqual(depois,antes,'Conteúdo restaurado não coincide com o manifesto de origem.');}
function run(programa,args,opcoes={}) {
 const resultado=spawnSync(programa,args,{encoding:'utf8',timeout:180_000,maxBuffer:30*1024*1024,...opcoes});
 if(resultado.error||resultado.status!==0)throw new Error(`Etapa ${programa} falhou. Consulte o relatório privado.`,{cause:resultado.error??new Error(resultado.stderr)});
 return resultado.stdout;
}
function cli(args){
 args=['--agent','yes','--output-format','json',...args];
 // CLI recebe somente argumentos internos/validados; nenhuma credencial na linha de comando.
 if(process.platform==='win32')return run('powershell.exe',['-NoProfile','-NonInteractive','-Command','& supabase '+args.map(a=>"'"+a.replaceAll("'","''")+"'").join(' ')]);
 return run('supabase',args);
}
const pausar=ms=>new Promise(r=>setTimeout(r,ms));
async function restaurarPrivado(pasta,manifest,arquivos) {
 const estrutura=arquivos?.['estrutura.sql']??await readFile(join(pasta,'estrutura.sql'),'utf8');const dados=arquivos?.['dados.sql']??await readFile(join(pasta,'dados.sql'),'utf8');
 const container=run('docker',['run','-d','--network','none','-e','POSTGRES_PASSWORD=restore-local','-e','POSTGRES_DB=restore','postgres:17-alpine']).trim();
 if(!/^[a-f0-9]{64}$/.test(container))throw new Error('Identificador do banco descartável inválido.');
 try{
  for(let i=0;i<30;i++){if(spawnSync('docker',['exec',container,'pg_isready','-U','postgres','-d','restore']).status===0)break;await pausar(1000);}
  const roles=new Set(['anon','authenticated','service_role','supabase_admin','supabase_auth_admin','supabase_storage_admin','authenticator','dashboard_user','supabase_read_only_user']);
  for(const m of estrutura.matchAll(/(?:OWNER TO|GRANT [^\n]+ TO|REVOKE [^\n]+ FROM|FOR ROLE) "([a-z_]+)"/g))if(!m[1].startsWith('pg_')&&m[1]!=='postgres')roles.add(m[1]);
  const preamble=[...roles].map(r=>`create role "${r}" nologin;`).join('\n')+'\ncreate schema if not exists extensions;create extension if not exists pgcrypto with schema extensions;';
  const psql=input=>run('docker',['exec','-i',container,'psql','-U','postgres','-d','restore','-v','ON_ERROR_STOP=1','-q'],{input});
  psql(preamble);psql(estrutura);psql("set session_replication_role='replica';\n"+dados+"\nset session_replication_role='origin';");
  const resposta=run('docker',['exec','-i',container,'psql','-U','postgres','-d','restore','-v','ON_ERROR_STOP=1','-t','-A','-q'],{input:manifestSql});
  compararManifestos(manifest,JSON.parse(resposta.trim()));
  return {restaurado:true,tabelasConferidas:manifest.length};
 }finally{run('docker',['rm','-f',container]);}
}
export async function executarBackup(destino,reference) {
 validarDestinoBackup(destino);
 const vinculado=(await readFile(resolve('supabase/.temp/project-ref'),'utf8')).trim();
 if(reference!==vinculado||!/^[a-z]{20}$/.test(reference))throw new Error('Confirme explicitamente o projeto vinculado.');
 const chaves=await obterChavesBackup();
 const pasta=join(destino,new Date().toISOString().replaceAll(':','-').replaceAll('.','-'));
 await mkdir(pasta,{recursive:true});
 if(process.platform==='win32')run('icacls.exe',[pasta,'/inheritance:r','/grant:r',`${process.env.USERDOMAIN}\\${process.env.USERNAME}:(OI)(CI)F`,'*S-1-5-18:(OI)(CI)F']);
 let etapa='manifesto';
 try{
  await writeFile(join(pasta,'manifesto.sql'),manifestSql);
  // Estrutura e dados completos dos schemas declarados; arquivos binários do Storage exigem cópia própria.
  etapa='dump_estrutura';cli(['db','dump','--linked','--schema',schemas.join(','),'--file',join(pasta,'estrutura.sql')]);
  etapa='dump_dados';cli(['db','dump','--linked','--schema',schemas.join(','),'--data-only','--use-copy','--file',join(pasta,'dados.sql')]);
  etapa='conferencia';const retorno=JSON.parse(cli(['db','query','--linked','--file',join(pasta,'manifesto.sql'),'-o','json']));
  const manifest=retorno.rows[0].manifest;await writeFile(join(pasta,'manifesto.json'),JSON.stringify(manifest));
  etapa='restauracao';const restauracao=await restaurarPrivado(pasta,manifest);
  const hashes={};for(const nome of ['estrutura.sql','dados.sql'])hashes[nome]=createHash('sha256').update(await readFile(join(pasta,nome))).digest('hex');
  const prova={data:new Date().toISOString(),projeto:reference,schemas,hashes,...restauracao,limites:['Objetos binários do Storage e configurações de serviço não fazem parte do dump SQL.','Históricos internos de migrações dos serviços Auth/Storage são excluídos pelo CLI; o destino de produção precisa dos serviços compatíveis já inicializados.','Backup diário neste computador exige computador ligado e sessão autorizada.']};
  etapa='criptografia';const arquivos={};for(const nome of ['estrutura.sql','dados.sql','manifesto.sql','manifesto.json'])arquivos[nome]=await readFile(join(pasta,nome),'utf8');
  const conteudo=Buffer.from(JSON.stringify(arquivos));const cifrado=criptografarCopia(conteudo,chaves.chavePublica);
  assert.deepEqual(abrirCopia(cifrado,chaves.chavePrivada),conteudo,'Cópia criptografada não confere.');
  await writeFile(join(pasta,'copia.enc'),cifrado,{flag:'wx'});
  prova.criptografia='AES-256-GCM + RSA-OAEP-SHA256';
  prova.chave='DPAPI CurrentUser; recuperação exige a conta Windows original ou chave privada exportada separadamente.';
  for(const nome of ['estrutura.sql','dados.sql','manifesto.sql','manifesto.json'])await unlink(join(pasta,nome));
  await writeFile(join(pasta,'VERIFICADO.json'),JSON.stringify(prova,null,2));
  console.log(JSON.stringify({pasta,restaurado:true,tabelasConferidas:manifest.length}));
 }catch{await writeFile(join(pasta,'FALHA.txt'),JSON.stringify({estado:'falha',etapa}));throw new Error('Backup não verificado. Consulte FALHA.txt no destino privado.');}
 finally{for(const nome of ['estrutura.sql','dados.sql','manifesto.sql','manifesto.json'])await unlink(join(pasta,nome)).catch(e=>{if(e.code!=='ENOENT')throw new Error('Falha ao remover arquivo temporário de backup.');});}
}
export async function verificarCopiaCriptografada(pasta){
 validarDestinoBackup(pasta);
 const {chavePrivada}=await obterChavesBackup();
 const arquivos=JSON.parse(abrirCopia(await readFile(join(pasta,'copia.enc')),chavePrivada).toString('utf8'));
 if(typeof arquivos['estrutura.sql']!=='string'||typeof arquivos['dados.sql']!=='string'||typeof arquivos['manifesto.json']!=='string')throw new Error('Conteúdo da cópia inválido.');
 return restaurarPrivado(pasta,JSON.parse(arquivos['manifesto.json']),arquivos);
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 try{if(process.argv[2]==='--verificar')console.log(JSON.stringify(await verificarCopiaCriptografada(process.argv[3])));else await executarBackup(process.argv[2]??'C:\\Backup\\financeiro-web\\automatico',process.argv[3]);}catch(e){console.error(e.message);process.exitCode=1;}
}
