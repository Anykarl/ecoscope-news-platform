param(
  [string]$BackendPort = "5001",
  [string]$BackupDesc = "ajustements_filtrage_et_logs"
)

$ErrorActionPreference = 'SilentlyContinue'

# Resolve project root as parent of this script's directory
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$Root = Split-Path -Parent $ScriptDir

# Ensure logs directory
$LogDir = Join-Path $Root 'logs'
if(!(Test-Path $LogDir)){ New-Item -ItemType Directory -Path $LogDir | Out-Null }
${stamp} = Get-Date -Format 'yyyyMMdd-HHmmss'
${backendLog} = Join-Path $LogDir ("backend-${stamp}.log")

Write-Host "[1/7] Vérification/libération du port $BackendPort..."
# Try with Get-NetTCPConnection if available, else netstat
try {
  $conns = Get-NetTCPConnection -LocalPort ([int]$BackendPort) -State Listen
  $pids = $conns | Select-Object -ExpandProperty OwningProcess -Unique
} catch {
  $lines = netstat -ano | Select-String ":$BackendPort"
  $pids = @()
  foreach($line in $lines){
    $parts = ($line.ToString() -split '\s+') | Where-Object { $_ -ne '' }
    if($parts.Length -ge 5){ $pids += $parts[-1] }
  }
  $pids = $pids | Select-Object -Unique
}
if($pids -and $pids.Count -gt 0){
  Write-Host "Port occupé par PID(s): $($pids -join ', '). Tentative de libération..."
  foreach($pid in $pids){ try { taskkill /PID $pid /F | Out-Null } catch { } }
} else {
  Write-Host "Port $BackendPort libre."
}

Write-Host "[2/7] Démarrage du backend (nouvelle fenêtre, logs -> $backendLog)..."
# Launch backend and capture its output into a log file in the spawned window
$startCmd = "npm run backend:dev 2>&1 | Tee-Object -FilePath `"$backendLog`""
Start-Process -FilePath "powershell" -ArgumentList @('-NoProfile','-Command', $startCmd) -WorkingDirectory $Root | Out-Null

Write-Host "[3/7] Attente de /health (60s max)..."
$ok=$false; $deadline=(Get-Date).AddSeconds(60)
while(-not $ok -and (Get-Date) -lt $deadline){
  try {
    $r=Invoke-WebRequest -UseBasicParsing -Uri ("http://127.0.0.1:{0}/health" -f $BackendPort) -TimeoutSec 3
    if($r.StatusCode -eq 200){ $ok=$true; break }
  } catch { Start-Sleep -Milliseconds 500 }
}
if($ok){ Write-Host "Backend OK" } else { Write-Host "Backend KO (timeout)."; exit 1 }

Write-Host "[4/7] Lancement du scraper et capture des logs..."
$logFile = Join-Path $LogDir ("scrape-{0}.log" -f $stamp)
Push-Location $Root
npm run scrape 2>&1 | Tee-Object -FilePath $logFile | Out-Null
Pop-Location
Write-Host ("Logs sauvegardés: {0}" -f $logFile)

Write-Host "[5/7] Analyse des logs..."
$log = Get-Content $logFile -Raw
$collectMatch = [regex]::Match($log, '📥 Collecte brute: (\d+)')
$skippedMatch = [regex]::Match($log, '🚫 Skipped: (\d+)')
$dedupMatch = [regex]::Match($log, '📦 Après déduplication inter-sources: (\d+)')
$collect = if ($collectMatch.Success) { [int]$collectMatch.Groups[1].Value } else { 0 }
$skipped = if ($skippedMatch.Success) { [int]$skippedMatch.Groups[1].Value } else { 0 }
$after = if ($dedupMatch.Success) { [int]$dedupMatch.Groups[1].Value } else { 0 }

# Reasons
$reasons = @{}
foreach($m in [regex]::Matches($log, '^\s*x \[\d+\] reason=([^\s]+)', 'Multiline')){
  $key = $m.Groups[1].Value
  if(-not $reasons.ContainsKey($key)){ $reasons[$key]=0 }
  $reasons[$key]++
}

# Build diagnostic
$topReasons = ($reasons.GetEnumerator() | Sort-Object -Property Value -Descending |
  Select-Object -First 5 |
  ForEach-Object { "{0}({1})" -f $_.Key, $_.Value }) -join ', '
$rec = @()
if ($skipped -gt 0 -and $reasons.ContainsKey('bad-title') -and ($reasons['bad-title'] / [double]$skipped -gt 0.5)) { $rec += 'Assouplir BAD_TITLE_RX / isBadTitle().' }
if ($collect -gt 0 -and (($collect - $after) / [double]$collect) -gt 0.4) { $rec += 'Vérifier la déduplication inter-sources et patterns d’URL.' }
if ($reasons.ContainsKey('non-article')) { $rec += 'Ajuster les sélecteurs pour cibler les pages article.' }
if ($reasons.ContainsKey('anchor-or-live') -or $reasons.ContainsKey('av-or-live')) { $rec += 'Continuer d’exclure /live et /av; envisager des règles plus spécifiques si trop agressif.' }
if ($rec.Count -eq 0) { $rec += 'RAS: filtrage et déduplication semblent raisonnables.' }

$diagText = @(
  ("Collecte={0}, Skipped={1}, AprèsDédup={2}" -f $collect, $skipped, $after),
  ("Principales raisons: {0}" -f $topReasons),
  ("Recommandations: {0}" -f ($rec -join ' | '))
) -join "`r`n"

$diagFile = Join-Path $LogDir ("diagnostic-{0}.txt" -f $stamp)
$diagText | Set-Content -Path $diagFile -Encoding UTF8
Write-Host ("Diagnostic sauvegardé: {0}" -f $diagFile)

Write-Host "[6/7] Sauvegarde zip (backup)..."
Push-Location $Root
npm run backup -- "$BackupDesc" | Out-Null
Pop-Location

# Determine NN and date from backups/history.txt
$historyPath = Join-Path $Root 'backups\history.txt'
$NN = '01'; $dateStr = (Get-Date -Format 'yyyy-MM-dd')
if (Test-Path $historyPath) {
  $last = Get-Content $historyPath | Select-Object -Last 1
  $m = [regex]::Match($last, '^(\d{2}) - (\d{4}-\d{2}-\d{2}) :')
  if ($m.Success) { $NN=$m.Groups[1].Value; $dateStr=$m.Groups[2].Value }
}

Write-Host "[7/7] Commit Git..."
Push-Location $Root
if (-not (Test-Path ".git")) { git init | Out-Null }
# Ensure branch principal
try {
  $currentBranch = (git rev-parse --abbrev-ref HEAD 2>$null)
} catch { $currentBranch = '' }
if ($currentBranch -ne 'principal') {
  try { git branch -M principal | Out-Null } catch { git checkout -b principal | Out-Null }
}

git add .
$commitMsg = "sauvegarde_${NN}_${dateStr}_ajustements_filtrage_et_logs"
# Add a one-line comment header by using -m twice: first line then the subject line
try { git commit -m "Automatisation: logs, analyse, backup" -m $commitMsg | Out-Null } catch { }
Pop-Location

Write-Host "RESUME:"
Write-Host ("- Log: {0}" -f $logFile)
Write-Host ("- Diagnostic: {0}" -f $diagFile)
Write-Host ("- Backup+Commit: OK (commit={0})" -f $commitMsg)
