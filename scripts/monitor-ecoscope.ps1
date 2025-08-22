param(
  [string]$ProjectRoot = (Split-Path -Parent $MyInvocation.MyCommand.Path | Split-Path -Parent),
  [string]$SummaryPath
)

$ErrorActionPreference = 'Stop'
if (-not $SummaryPath) { $SummaryPath = Join-Path $ProjectRoot 'last-run-summary.txt' }

function Ensure-EventSource {
  param([string]$Source = 'EcoScopeMonitor', [string]$LogName = 'Application')
  try {
    if (-not [System.Diagnostics.EventLog]::SourceExists($Source)) {
      New-EventLog -LogName $LogName -Source $Source | Out-Null
    }
  } catch {
    # If no admin rights, continue without creating source; Write-EventLog will fail -> fallback to console
  }
}

if (-not (Test-Path $SummaryPath)) {
  Write-Host "[Monitor] Summary introuvable: $SummaryPath" -ForegroundColor Yellow
  exit 2
}

$content = Get-Content -Raw $SummaryPath
$hasError = $false
$patterns = @(
  'ERROR','ERREUR','FAIL','Echec','Échec',
  'app crashed','EADDRINUSE','Health non OK','Health check échoué'
)
foreach($p in $patterns){ if ($content -match [regex]::Escape($p)) { $hasError = $true; break } }

if ($hasError) {
  Write-Host "[Monitor] Anomalies détectées dans le dernier run" -ForegroundColor Red
  try {
    Ensure-EventSource
    Write-EventLog -LogName Application -Source EcoScopeMonitor -EntryType Error -EventId 1001 -Message $content
  } catch {}
  exit 1
} else {
  Write-Host "[Monitor] Dernier run OK" -ForegroundColor Green
  try {
    Ensure-EventSource
    Write-EventLog -LogName Application -Source EcoScopeMonitor -EntryType Information -EventId 1000 -Message "EcoScope OK"
  } catch {}
  exit 0
}
