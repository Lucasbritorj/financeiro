param(
 [Parameter(Mandatory=$true)][string]$RaizProjeto,
 [Parameter(Mandatory=$true)][string]$NodeExecutavel,
 [Parameter(Mandatory=$true)][ValidatePattern('^[a-z]{20}$')][string]$ProjetoSupabase
)
$ErrorActionPreference='Stop'
$mutexBackup=New-Object System.Threading.Mutex($false,'Local\FinanceiroBackupVerificado')
$adquirido=$false
try {
 $adquirido=$mutexBackup.WaitOne(0)
 if(-not $adquirido){exit 0}
 $raizResolvida=(Resolve-Path -LiteralPath $RaizProjeto).Path
 if($raizResolvida -ne 'C:\Claude-Matriz\Projetos\financeiro-web'){throw 'Raiz do projeto não autorizada.'}
 Set-Location -LiteralPath $raizResolvida
 $referencia=(Get-Content -LiteralPath 'supabase/.temp/project-ref' -Raw).Trim()
 if($referencia -ne $ProjetoSupabase){throw 'Projeto vinculado diverge do agendamento.'}
 & $NodeExecutavel 'scripts/backup-financeiro.mjs' 'C:\Backup\financeiro-web\automatico' $ProjetoSupabase
 if($LASTEXITCODE -ne 0){throw 'Backup não verificado.'}
 @{data=(Get-Date).ToUniversalTime().ToString('o');estado='verificado'} | ConvertTo-Json | Set-Content -LiteralPath 'C:\Backup\financeiro-web\ultimo-agendamento.json'
} catch {
 # Apenas o estado: exceções de ferramentas podem conter consultas ou credenciais.
 if(Test-Path -LiteralPath 'C:\Backup\financeiro-web'){
  @{data=(Get-Date).ToUniversalTime().ToString('o');estado='falha';acao='Verifique Docker, autorização do Supabase e chave Windows.'} | ConvertTo-Json | Set-Content -LiteralPath 'C:\Backup\financeiro-web\ultimo-agendamento.json'
 }
 Write-Error 'Backup automático falhou. Verifique o estado privado em C:\Backup\financeiro-web.'
 exit 1
} finally {
 if($adquirido){$mutexBackup.ReleaseMutex()}
 $mutexBackup.Dispose()
}
