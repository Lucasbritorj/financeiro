import {generateKeyPairSync} from 'node:crypto';
import {mkdir,readFile,writeFile,access} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {join} from 'node:path';
const raiz='C:\\Backup\\financeiro-web\\chaves';
function powershell(codigo,input){const r=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',codigo],{input,encoding:'utf8',timeout:15000});if(r.status!==0||r.error)throw new Error('Não foi possível acessar a chave privada de backup.');return r.stdout.trim();}
export async function obterChavesBackup(){
 if(process.platform!=='win32')throw new Error('Configure armazenamento privado de chave neste sistema; esta rotina usa Windows DPAPI.');
 await mkdir(raiz,{recursive:true});
 const acl=spawnSync('icacls.exe',[raiz,'/inheritance:r','/grant:r',`${process.env.USERDOMAIN}\\${process.env.USERNAME}:(OI)(CI)F`,'*S-1-5-18:(OI)(CI)F'],{encoding:'utf8'});if(acl.status!==0)throw new Error('Não foi possível restringir acesso às chaves.');
 const privada=join(raiz,'privada.dpapi'),publica=join(raiz,'publica.pem');
 const existe=await access(privada).then(()=>true,()=>false);
 if(!existe){
  const {publicKey,privateKey}=generateKeyPairSync('rsa',{modulusLength:3072,publicKeyEncoding:{type:'spki',format:'pem'},privateKeyEncoding:{type:'pkcs8',format:'pem'}});
  const protegida=powershell("Add-Type -AssemblyName System.Security; $bytes=[Text.Encoding]::UTF8.GetBytes([Console]::In.ReadToEnd()); [Convert]::ToBase64String([Security.Cryptography.ProtectedData]::Protect($bytes,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser))",privateKey);
  await writeFile(privada,protegida,{flag:'wx'});await writeFile(publica,publicKey,{flag:'wx'});
 }
 const protegida=await readFile(privada,'utf8');
 const chavePrivada=powershell("Add-Type -AssemblyName System.Security; $bytes=[Convert]::FromBase64String([Console]::In.ReadToEnd()); [Text.Encoding]::UTF8.GetString([Security.Cryptography.ProtectedData]::Unprotect($bytes,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser))",protegida);
 return {chavePublica:await readFile(publica,'utf8'),chavePrivada};
}
