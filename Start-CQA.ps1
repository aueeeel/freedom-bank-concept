param([switch]$NoBrowser,[switch]$DownloadModel,[int]$SitePort=4173,[int]$CheckerPort=8088)
$ErrorActionPreference='Stop'
$projectRoot=$PSScriptRoot
$checkerRoot=Join-Path $projectRoot 'checker'
$logs=Join-Path $checkerRoot 'data\runtime\logs'
New-Item -ItemType Directory -Path $logs -Force | Out-Null
$bundled=Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe'
if($env:CQA_PYTHON){$pythonPath=$env:CQA_PYTHON}
elseif(Test-Path -LiteralPath (Join-Path $checkerRoot '.venv\Scripts\python.exe')){$pythonPath=Join-Path $checkerRoot '.venv\Scripts\python.exe'}
elseif(Test-Path -LiteralPath $bundled){$pythonPath=$bundled}
else{$pythonPath=(Get-Command python -ErrorAction Stop).Source}
$nodePath=(Get-Command node -ErrorAction Stop).Source
$env:PYTHONIOENCODING='utf-8'
$modelUrl='http://127.0.0.1:11435'
$modelReady=$false
try{$null=Invoke-RestMethod ($modelUrl+'/api/version') -TimeoutSec 3;$modelReady=$true}catch{}
if(-not $modelReady){
 $ollama=(Get-Command ollama -ErrorAction SilentlyContinue).Source
 if(-not $ollama){$ollama=Join-Path $env:LOCALAPPDATA 'Programs\Ollama\ollama.exe'}
 if(-not(Test-Path -LiteralPath $ollama)){throw 'Install Ollama from https://ollama.com, then run Start-CQA.ps1 again.'}
 $env:OLLAMA_HOST='127.0.0.1:11435';$env:OLLAMA_NO_CLOUD='1';$env:OLLAMA_NUM_PARALLEL='1';$env:OLLAMA_MAX_LOADED_MODELS='1';$env:OLLAMA_FLASH_ATTENTION='1';$env:OLLAMA_KV_CACHE_TYPE='q4_0';$env:LLAMA_ARG_CTX_CHECKPOINTS='0';$env:LLAMA_ARG_CACHE_RAM='0'
 $modelProcess=Start-Process -FilePath $ollama -ArgumentList 'serve' -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $logs 'ollama.stdout.log') -RedirectStandardError (Join-Path $logs 'ollama.stderr.log')
 for($attempt=0;$attempt -lt 30;$attempt++){try{$null=Invoke-RestMethod ($modelUrl+'/api/version') -TimeoutSec 2;$modelReady=$true;break}catch{Start-Sleep -Milliseconds 300}}
 if(-not $modelReady){throw 'Local Ollama did not start. Check checker/data/runtime/logs.'}
}
$tags=Invoke-RestMethod ($modelUrl+'/api/tags') -TimeoutSec 5
if(-not($tags.models | Where-Object {$_.name -eq 'qwen3.5:4b'})){
 if(-not $DownloadModel){throw 'Model not installed. Run Start-CQA.ps1 -DownloadModel for the first download.'}
 $ollama=(Get-Command ollama -ErrorAction Stop).Source;$env:OLLAMA_HOST='127.0.0.1:11435'
 & $ollama pull qwen3.5:4b
 if($LASTEXITCODE -ne 0){throw 'Model download failed.'}
}
Push-Location $projectRoot
try{
 if(-not(Test-Path -LiteralPath (Join-Path $projectRoot 'node_modules/esbuild'))){& npm.cmd ci;if($LASTEXITCODE -ne 0){throw 'npm ci failed.'}}
 if(-not(Test-Path -LiteralPath (Join-Path $projectRoot 'local-ui/dist/check.html'))){& npm.cmd run local:build;if($LASTEXITCODE -ne 0){throw 'Local build failed.'}}
}finally{Pop-Location}
$backendUrl='http://127.0.0.1:'+$CheckerPort
$backendReady=$false
try{$health=Invoke-RestMethod ($backendUrl+'/api/health') -TimeoutSec 3;$backendReady=$health.ok}catch{}
if(-not $backendReady){
 $backend=Start-Process -FilePath $pythonPath -ArgumentList @('-m','cqa','web','--port',"$CheckerPort",'--static-dir',('"'+(Join-Path $projectRoot 'review-ui')+'"')) -WorkingDirectory $checkerRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $logs 'web.stdout.log') -RedirectStandardError (Join-Path $logs 'web.stderr.log')
 for($attempt=0;$attempt -lt 30;$attempt++){try{$health=Invoke-RestMethod ($backendUrl+'/api/health') -TimeoutSec 2;if($health.ok){$backendReady=$true;break}}catch{Start-Sleep -Milliseconds 300};$backend.Refresh();if($backend.HasExited){throw 'Checker exited. See checker/data/runtime/logs/web.stderr.log.'}}
 if(-not $backendReady){throw 'Checker did not become ready.'}
}
$siteUrl='http://127.0.0.1:'+$SitePort+'/check.html'
$siteReady=$false
try{$response=Invoke-WebRequest $siteUrl -UseBasicParsing -TimeoutSec 3;$siteReady=$response.StatusCode -eq 200}catch{}
if(-not $siteReady){
 $env:PORT="$SitePort";$env:CQA_BACKEND_PORT="$CheckerPort"
 $site=Start-Process -FilePath $nodePath -ArgumentList 'server-integrated.cjs' -WorkingDirectory (Join-Path $projectRoot 'local-ui') -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $logs 'site.stdout.log') -RedirectStandardError (Join-Path $logs 'site.stderr.log')
 for($attempt=0;$attempt -lt 30;$attempt++){try{$response=Invoke-WebRequest $siteUrl -UseBasicParsing -TimeoutSec 2;if($response.StatusCode -eq 200){$siteReady=$true;break}}catch{Start-Sleep -Milliseconds 300};$site.Refresh();if($site.HasExited){throw 'Site exited. See checker/data/runtime/logs/site.stderr.log.'}}
 if(-not $siteReady){throw 'Local site did not become ready.'}
}
if(-not $NoBrowser){Start-Process $siteUrl}
Write-Output ('CQA is ready: '+$siteUrl)
