param(
  [int]$BackendPort = 5001,
  [switch]$VerboseMode
)

# Auto EcoScope test pipeline orchestrator
# NOTE: Default backend port set to 5001 (stable), per request. Override with -BackendPort if needed.
# - Frees ports 5001/5002
# - Starts backend in dev mode on the specified port, logs to logs/backend-manual.log
# - Disables cron during automation (ENABLE_CRON=false) to stabilize health-check
# - Health-checks the backend
# - Runs scripts/run-sequence.ps1 with -SkipBackendStart and required env vars
# - Extracts artifacts (scrape log head, diagnostic, backup, git commit)
# - If diagnostic absent/empty -> runs generate-diagnostic.ps1 and reports
# - Final backup + git commit
# Use:  powershell -ExecutionPolicy Bypass -File .\auto-ecoscope-test.ps1 [-VerboseMode]

$ErrorActionPreference = 'Stop'
function Log($msg){ if($VerboseMode){ Write-Host ("[INFO] {0}" -f $msg) } else { Write-Host $msg } }
function Fail($msg){ Write-Error $msg; exit 1 }

# Robust port release helper (approved verb)
function Stop-ListenPort {
  param([Parameter(Mandatory=$true)][int]$Port)
  try {
    Get-NetTCPConnection -LocalPort $Port -ErrorAction SilentlyContinue |
      Select-Object -Unique OwningProcess,LocalPort |
      ForEach-Object {
        try { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue } catch {}
      }
    Start-Sleep -Milliseconds 500
  } catch { Write-Warning ("Port cleanup warning on {0}: {1}" -f $Port, $_) }
}

$Root = Get-Location
$LogDir = Join-Path $Root 'logs'
if(!(Test-Path $LogDir)){ New-Item -ItemType Directory -Path $LogDir | Out-Null }
$BackendLog = Join-Path $LogDir 'backend-manual.log'

# 1) Free ports 5001/5002 (robust)
try {
  Log "[1/8] Libération des ports 5001/5002 si nécessaires..."
  Stop-ListenPort 5001
  Stop-ListenPort 5002
} catch { Fail "Erreur lors de la libération des ports: $_" }

# 2) Start backend in dev mode with tee to backend-manual.log
try {
  Log ("[2/8] Démarrage backend dev sur port {0}..." -f $BackendPort)
  $backendStart = @"
$env:PORT=$BackendPort; $env:BACKEND_PORT=$BackendPort; $env:ENABLE_CRON='false'; Push-Location .\backend; npx --yes nodemon server.js 2>&1 | Tee-Object -FilePath ..\logs\backend-manual.log
"@
  # Start in a new window so we can proceed; keep ps open
  $null = Start-Process -FilePath powershell -ArgumentList @('-NoProfile','-Command', $backendStart) -WorkingDirectory $Root.Path -PassThru
  Start-Sleep -Seconds 6
  if(!(Test-Path $BackendLog)){ Write-Warning "Aucun backend-manual.log pour l'instant (peut être normal)." }
  else { Log " - backend-manual.log présent." }
} catch { Fail "Échec démarrage backend: $_" }

# 3) Health-check loop (up to 60s)
try {
  Log "[3/8] Health-check backend (/health) (60s max)..."
  $deadline=(Get-Date).AddSeconds(60)
  $ok=$false
  while(-not $ok -and (Get-Date) -lt $deadline){
    try {
      $resp = Invoke-WebRequest -UseBasicParsing -Uri ("http://127.0.0.1:{0}/health" -f $BackendPort) -TimeoutSec 3
      if($resp.StatusCode -eq 200){ $ok=$true; break }
    } catch { Start-Sleep -Milliseconds 700 }
    # Detect nodemon crash early
    if (Test-Path $BackendLog) {
      $recent = Get-Content -Tail 100 -Path $BackendLog -ErrorAction SilentlyContinue
      if ($recent -and ($recent -join "`n") -match 'app crashed') {
        Write-Host "Nodemon signale un crash. Dernières lignes du backend-manual.log:";
        Get-Content -Tail 120 -Path $BackendLog | Out-Host
        Fail "Backend a crashé (nodemon)."
      }
    }
  }
  if(-not $ok){
    Write-Host "Backend KO (timeout). Dernières lignes backend-manual.log:"
    if(Test-Path $BackendLog){ Get-Content -Tail 120 -Path $BackendLog | Out-Host } else { Write-Host "(log absent)" }
    Fail "Backend indisponible."
  } else { Log " - Health OK (200)." }
} catch { Fail "Échec health-check: $_" }

# 4) Run pipeline without restarting backend
try {
  Log "[4/8] Exécution run-sequence.ps1 (SkipBackendStart)..."
  $env:ENRICH_CAP='50'
  $env:VIDEO_ENABLED='true'
  $env:VIDEO_KEYWORDS='climat,climate,environment,environnement,énergie,energie,pollution,biodiversité,biodiversity,eau,water,agriculture,canicule,heatwave,incendie,wildfire,nucléaire,nuclear,plastique,plastic'
  .\scripts\run-sequence.ps1 -BackendPort $BackendPort -SkipBackendStart
} catch { Fail "Échec run-sequence: $_" }

# 5) Extract artifacts
$Result = [ordered]@{}
try {
  Log "[5/8] Extraction artefacts (logs/diagnostic/backup/commit)..."
  $scrape = Get-ChildItem .\logs\scrape-*.log | Sort-Object LastWriteTime -Descending | Select-Object -First 1
  if(-not $scrape){ Fail "Aucun log de scraping trouvé." }
  $Result['ScrapeLog'] = $scrape.FullName
  $Result['ScrapeHead10'] = (Get-Content -TotalCount 10 -Path $scrape.FullName)

  $diag = Get-ChildItem .\logs\diagnostic-*.txt | Sort-Object LastWriteTime -Descending | Select-Object -First 1
  if($diag){
    $Result['DiagnosticFile'] = $diag.FullName
    $Result['DiagnosticSize'] = (Get-Item $diag.FullName).Length
    $Result['DiagnosticContent'] = (Get-Content -Raw $diag.FullName)
  } else {
    $Result['DiagnosticFile'] = '(absent)'
    $Result['DiagnosticSize'] = 0
    $Result['DiagnosticContent'] = ''
  }

  $zip = Get-ChildItem .\backups -Filter *.zip | Sort-Object LastWriteTime -Descending | Select-Object -First 1
  if($zip){ $Result['BackupZip'] = $zip.FullName } else { $Result['BackupZip'] = '(absent)' }

  $Result['GitLastCommit'] = (git -C . log -n 1 --oneline)
} catch { Fail "Échec extraction artefacts: $_" }

# 6) Fallback diagnostic if absent or empty
try {
  Log "[6/8] Vérification diagnostic (fallback si vide/absent)..."
  $needsFallback = $false
  if(-not $Result['DiagnosticContent'] -or [string]::IsNullOrWhiteSpace($Result['DiagnosticContent'])){ $needsFallback=$true }
  if($needsFallback -and (Test-Path .\generate-diagnostic.ps1)){
    Log " - Diagnostic absent/vide. Exécution generate-diagnostic.ps1..."
    .\generate-diagnostic.ps1 | Out-Host
    $diag2 = Join-Path $LogDir 'diagnostic-test.txt'
    if(Test-Path $diag2){
      $Result['DiagnosticFallbackFile'] = $diag2
      $Result['DiagnosticFallbackSize'] = (Get-Item $diag2).Length
      $Result['DiagnosticFallbackContent'] = (Get-Content -Raw $diag2)
    }
  }
} catch { Write-Warning "Fallback diagnostic a échoué: $_" }

# 7) Reporting succinct
try {
  Log "[7/8] Rapport:"
  Write-Host ("- Scraper log: {0}" -f $Result['ScrapeLog'])
  Write-Host "- Scraper head (10 lignes):"
  $Result['ScrapeHead10'] | ForEach-Object { Write-Host $_ }
  Write-Host ("- Diagnostic: {0}" -f $Result['DiagnosticFile'])
  Write-Host ("- Diagnostic taille: {0}" -f $Result['DiagnosticSize'])
  if($Result['DiagnosticContent']){ Write-Host "--- Diagnostic contenu ---"; Write-Host $Result['DiagnosticContent']; Write-Host "--- Fin diagnostic ---" }
  if($Result['DiagnosticFallbackFile']){
    Write-Host ("- Diagnostic fallback: {0} (taille={1})" -f $Result['DiagnosticFallbackFile'], $Result['DiagnosticFallbackSize'])
    Write-Host "--- Diagnostic fallback contenu ---"; Write-Host $Result['DiagnosticFallbackContent']; Write-Host "--- Fin fallback ---"
  }
  Write-Host ("- Backup ZIP: {0}" -f $Result['BackupZip'])
  Write-Host ("- Git commit: {0}" -f $Result['GitLastCommit'])
} catch { Fail "Échec reporting: $_" }

# 8) Final backup + commit
try {
  Log "[8/8] Sauvegarde finale + commit Git..."
  npm run backup -- "auto_session" | Out-Null
  git add .
  # Ensure desired Git identity for this commit
  git config user.email "2anykarl1994@gmail.com"
  git config user.name "2anykarl"
  git commit -m "session: auto pipeline ecoscope-test" -m "Run 5002 + logs/diagnostics/backup" | Out-Null
  Write-Host "Terminé avec succès."
} catch { Write-Warning "Backup/commit final a échoué: $_"; exit 0 }
