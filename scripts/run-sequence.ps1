param(
  [int]$BackendPort = 5001,
  [string]$BackupDesc = "Auto",
  [switch]$SkipBackendStart,
  [int]$EnrichCap
)

$ErrorActionPreference = 'SilentlyContinue'
$pipelineStart = Get-Date

# Resolve project root as parent of this script's directory
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$Root = Split-Path -Parent $ScriptDir

# Ensure logs directory
$LogDir = Join-Path $Root 'logs'
if(!(Test-Path $LogDir)){ New-Item -ItemType Directory -Path $LogDir | Out-Null }
${stamp} = Get-Date -Format 'yyyyMMdd-HHmmss'
${backendLog} = Join-Path $LogDir ("backend-${stamp}.log")

Write-Host "[0/7] Installation des dépendances (npm install)..."
Push-Location $Root
try { npm install | Out-Null } catch { }
Pop-Location

if (-not $SkipBackendStart) { Write-Host "[1/7] Vérification/libération du port $BackendPort..." }
function Stop-ProcessOnPort {
  param([int]$port)
  $pids = @(netstat -ano | Select-String ":$port\s" | ForEach-Object { ($_ -split '\s+')[-1] }) | Select-Object -Unique
  if(-not $pids -or $pids.Count -eq 0){ Write-Host "Port $port libre."; return $true }
  foreach($pid in $pids){
    Write-Host "Le port $port est occupé par PID $pid. Arrêt du processus..."
    try { Stop-Process -Id $pid -Force -ErrorAction Stop; Write-Host "Processus $pid arrêté." }
    catch { Write-Warning "Impossible d'arrêter le processus $pid : $_"; return $false }
  }
  return $true
}

if (-not $SkipBackendStart) {
  if (-not (Stop-ProcessOnPort -port ([int]$BackendPort))) {
    Write-Error "Impossible de libérer le port $BackendPort. Arrêt du script."; exit 1
  }

  Write-Host "Attente que le port $BackendPort soit libéré..."
  $timeout = 15; $elapsed = 0
  while ($elapsed -lt $timeout) {
    Start-Sleep -Seconds 1
    $pidsNow = @(netstat -ano | Select-String ":$BackendPort\s" | ForEach-Object { ($_ -split '\s+')[-1] })
    if ($pidsNow.Count -eq 0) { Write-Host "Port $BackendPort est désormais libre."; break }
    $elapsed++
  }
  if ($elapsed -ge $timeout) { Write-Warning "Port $BackendPort toujours occupé après $timeout s."; Write-Error "Arrêt du script pour éviter conflit de port."; exit 1 }

  Write-Host "[2/7] Démarrage du backend (nouvelle fenêtre, logs -> $backendLog) sur le port $BackendPort..."
  # Launch backend with env PORT/BACKEND_PORT and capture output
  $startCmd = "$env:PORT=$BackendPort; $env:BACKEND_PORT=$BackendPort; npm run backend:dev 2>&1 | Tee-Object -FilePath `"$backendLog`""
  Start-Process -FilePath "powershell" -ArgumentList @('-NoProfile','-Command', $startCmd) -WorkingDirectory $Root | Out-Null

  Write-Host "[3/7] Attente de /health (90s max)..."
  $ok=$false; $deadline=(Get-Date).AddSeconds(90)
  while(-not $ok -and (Get-Date) -lt $deadline){
    try {
      $r=Invoke-WebRequest -UseBasicParsing -Uri ("http://127.0.0.1:{0}/health" -f $BackendPort) -TimeoutSec 3
      if($r.StatusCode -eq 200){ $ok=$true; break }
    } catch { Start-Sleep -Milliseconds 500 }
  }
  if(-not $ok){
    Write-Host "Backend KO (timeout)."
    Write-Host "--- Dernières lignes du log backend ---"
    if (Test-Path $backendLog) {
      try { Get-Content -Tail 80 -Path $backendLog | Out-Host } catch {}
      Write-Host "--- Fin log backend ---"
    } else {
      Write-Host ("(Log introuvable: {0})" -f $backendLog)
    }
    exit 1
  }
} else {
  Write-Host "[1-3/7] Saut des étapes backend (SkipBackendStart=true). Vérification rapide de /health..."
  try {
    $r=Invoke-WebRequest -UseBasicParsing -Uri ("http://127.0.0.1:{0}/health" -f $BackendPort) -TimeoutSec 3
    if($r.StatusCode -ne 200){ Write-Host "Health non OK (code $($r.StatusCode))."; exit 1 }
  } catch { Write-Host "Health check échoué: $_"; exit 1 }
}

Write-Host "[4/7] Lancement du scraper et capture des logs..."
$logFile = Join-Path $LogDir ("scrape-{0}.log" -f $stamp)
Push-Location $Root
$env:ECOSCOPE_API_URL = "http://127.0.0.1:$BackendPort/api/news"
if ($EnrichCap -gt 0) {
  $env:ENRICH_CAP = [string]$EnrichCap
  $env:MAX_ENRICH = [string]$EnrichCap
  Write-Host ("ENRICH_CAP/MAX_ENRICH forcés à {0}" -f $EnrichCap)
}
npm run scrape 2>&1 | Tee-Object -FilePath $logFile | Out-Null
Pop-Location
Write-Host ("Logs sauvegardés: {0}" -f $logFile)

Write-Host "[5/7] Analyse des logs..."
$log = Get-Content $logFile -Raw
# Prefer ASCII markers to avoid emoji/encoding issues
$collectMatch = [regex]::Match($log, 'RAW_COUNT:\s*(\d+)', 'IgnoreCase')
$skippedMatch = [regex]::Match($log, 'SKIPPED_COUNT:\s*(\d+)', 'IgnoreCase')
$dedupMatch = [regex]::Match($log, 'DEDUP_COUNT:\s*(\d+)', 'IgnoreCase')
$enrichCapUsedMatch = [regex]::Match($log, 'ENRICH_CAP_USED:\s*(\d+)', 'IgnoreCase')
$postSummaryMatch = [regex]::Match($log, 'POST_SUMMARY:\s*ok=(\d+)\s+ko=(\d+)\s+total=(\d+)', 'IgnoreCase')
$collect = if ($collectMatch.Success) { [int]$collectMatch.Groups[1].Value } else { 0 }
$skipped = if ($skippedMatch.Success) { [int]$skippedMatch.Groups[1].Value } else { 0 }
$after = if ($dedupMatch.Success) { [int]$dedupMatch.Groups[1].Value } else { 0 }
$enrichCapUsed = if ($enrichCapUsedMatch.Success) { [int]$enrichCapUsedMatch.Groups[1].Value } else { $null }
$postOk = if ($postSummaryMatch.Success) { [int]$postSummaryMatch.Groups[1].Value } else { $null }
$postKo = if ($postSummaryMatch.Success) { [int]$postSummaryMatch.Groups[2].Value } else { $null }
$postTotal = if ($postSummaryMatch.Success) { [int]$postSummaryMatch.Groups[3].Value } else { $null }

# Fallbacks if markers not found
if ($collect -eq 0) {
  $m = [regex]::Match($log, 'Collecte brute:\s*(\d+)'); if ($m.Success) { $collect = [int]$m.Groups[1].Value }
}
if ($skipped -eq 0) {
  $m = [regex]::Match($log, 'Skipped:\s*(\d+)'); if ($m.Success) { $skipped = [int]$m.Groups[1].Value }
}
if ($after -eq 0) {
  $m = [regex]::Match($log, 'Après déduplication inter-sources:\s*(\d+)'); if ($m.Success) { $after = [int]$m.Groups[1].Value }
}

# Reasons
$reasons = @{}
foreach($m in [regex]::Matches($log, '^\s*x \[\d+\] reason=([^\s]+)', 'Multiline')){
  $key = $m.Groups[1].Value
  if(-not $reasons.ContainsKey($key)){ $reasons[$key]=0 }
  $reasons[$key]++
}

# Per-source quick counts from SRC_SUMMARY
$srcSummaries = @()
foreach($m in [regex]::Matches($log, 'SRC_SUMMARY:\s*([^\s]+)\s+collected=(\d+)', 'IgnoreCase')){
  $srcName = $m.Groups[1].Value
  $cnt = [int]$m.Groups[2].Value
  $srcSummaries += ("{0}={1}" -f $srcName, $cnt)
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

$diagLines = @()

# Runtime since start of this script
$elapsedSec = [int]((Get-Date) - $pipelineStart).TotalSeconds
$diagLines += ("RuntimeSeconds={0}" -f $elapsedSec)

$diagLines += ("Collecte={0}, Skipped={1}, AprèsDédup={2}" -f $collect, $skipped, $after)
if ($null -ne $enrichCapUsed) { $diagLines += ("Enrichment cap utilisé: {0}" -f $enrichCapUsed) }
if ($null -ne $postTotal) { $diagLines += ("Post: ok={0} ko={1} total={2}" -f $postOk, $postKo, $postTotal) }

# Overall post success rate if available
if ($null -ne $postTotal -and $postTotal -gt 0 -and $null -ne $postOk) {
  $succ = [math]::Round((100.0 * $postOk / [double]$postTotal), 1)
  $diagLines += ("Post success rate: {0}%" -f $succ)
}

# Per-source percentages (based on collected share)
if ($srcSummaries.Count -gt 0 -and $collect -gt 0) {
  $srcPct = @()
  foreach($item in $srcSummaries){
    $parts = $item -split '='
    if ($parts.Count -eq 2) {
      $name = $parts[0]; $cnt = [int]$parts[1]
      $p = [math]::Round((100.0 * $cnt / [double]$collect), 1)
      $srcPct += ("{0}={1}%" -f $name, $p)
    }
  }
  if ($srcPct.Count -gt 0) { $diagLines += ("Par source (%): {0}" -f ($srcPct -join ', ')) }
}

# Videos vs Articles (heuristic: sources containing 'video' are considered videos)
if ($srcSummaries.Count -gt 0) {
  $videoCollected = 0
  foreach($item in $srcSummaries){
    $parts = $item -split '='
    if ($parts.Count -eq 2) {
      $name = $parts[0]; $cnt = [int]$parts[1]
      if ($name -match '(?i)video') { $videoCollected += $cnt }
    }
  }
  $articleCollected = [math]::Max(0, $collect - $videoCollected)
  $diagLines += ("Contenus: videos={0} articles={1}" -f $videoCollected, $articleCollected)
}
if ($srcSummaries.Count -gt 0) { $diagLines += ("Par source: {0}" -f ($srcSummaries -join ', ')) }
$diagLines += ("Principales raisons: {0}" -f $topReasons)
$diagLines += ("Recommandations: {0}" -f ($rec -join ' | '))
$diagText = $diagLines -join "`r`n"

$diagHeader = ("=== Diagnostic {0} ===" -f (Get-Date -Format 's'))
if ([string]::IsNullOrWhiteSpace($diagText)) {
  $finalDiag = "$diagHeader`r`n(empty: no markers found in scrape log)"
} else {
  $finalDiag = "$diagHeader`r`n$diagText"
}

$diagFile = Join-Path $LogDir ("diagnostic-{0}.txt" -f $stamp)
$finalDiag | Set-Content -Path $diagFile -Encoding UTF8
$diagLen = (Get-Item $diagFile).Length
Write-Host ("Diagnostic sauvegardé: {0} (taille={1} octets)" -f $diagFile, $diagLen)

# Fallback: if diagnostic missing or empty, try generator script
if (-not (Test-Path $diagFile) -or ((Get-Item $diagFile).Length -lt 10)) {
  Write-Warning "Diagnostic vide ou introuvable, tentative via generate-diagnostic.ps1..."
  $gen = Join-Path $Root 'generate-diagnostic.ps1'
  if (Test-Path $gen) {
    try {
      & $gen -OutFile $diagFile 2>$null
      if (Test-Path $diagFile) {
        $diagLen = (Get-Item $diagFile).Length
        Write-Host ("Diagnostic (fallback) sauvegardé: {0} (taille={1} octets)" -f $diagFile, $diagLen)
      }
    } catch {
      Write-Warning "Echec du generate-diagnostic.ps1: $_"
    }
  } else {
    Write-Warning "generate-diagnostic.ps1 introuvable au chemin: $gen"
  }
}

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

# Write a non-ignored summary for convenience
$summaryPath = Join-Path $Root 'last-run-summary.txt'
$latestZip = $null
if (Test-Path (Join-Path $Root 'backups')) {
  $latestZip = Get-ChildItem -Path (Join-Path $Root 'backups') -Filter '*.zip' | Sort-Object LastWriteTime -Descending | Select-Object -First 1
}

# Git info
$branch = ''
$commitShort = ''
try { $branch = (git rev-parse --abbrev-ref HEAD 2>$null).Trim() } catch {}
try { $commitShort = (git rev-parse --short HEAD 2>$null).Trim() } catch {}

$summary = @(
  "Log file: $logFile",
  "Diagnostic file: $diagFile",
  ("Latest backup: {0}" -f ($latestZip.FullName)) ,
  ("Git: branch={0} commit={1}" -f $branch, $commitShort),
  "",
  "--- Diagnostic Content ---",
  (Get-Content -Raw $diagFile)
) -join "`r`n"
$summary | Set-Content -Path $summaryPath -Encoding UTF8
Write-Host ("Summary written: {0}" -f $summaryPath)
