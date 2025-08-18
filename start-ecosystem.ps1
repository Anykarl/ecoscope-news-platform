# Start all EcoScope services (Windows PowerShell)
# - Backend with cron every 15 minutes
# - Wait for backend on port 5001
# - Optionally seed by running the scraper once
# - Frontend in dev mode
# - Opens separate windows, logs to ./logs/*.log

$ErrorActionPreference = 'Stop'

# Paths
$RepoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$BackendDir = Join-Path $RepoRoot 'backend'
$FrontendDir = Join-Path $RepoRoot 'frontend'
$LogsDir = Join-Path $RepoRoot 'logs'

# Ensure logs directory exists
if (-not (Test-Path -Path $LogsDir)) {
  New-Item -ItemType Directory -Path $LogsDir | Out-Null
}

# Start backend with cron in a new window, keep window open, and tee logs
$backendCmd = "$env:SCRAPE_INTERVAL_MINUTES=15; cd `"$BackendDir`"; Write-Host '🚀 Starting Backend (cron interval 15m)...'; npm run dev 2>&1 | Tee-Object -FilePath `"$LogsDir/backend.log`" -Append"
Start-Process powershell -ArgumentList "-NoExit", "-Command", $backendCmd -WindowStyle Normal

# Wait for backend port 5001 (IPv4)
Write-Host "⏳ Waiting for backend on 127.0.0.1:5001 ..."
$maxWaitSeconds = 120
$elapsed = 0
while ($true) {
  try {
    $t = Test-NetConnection -ComputerName 127.0.0.1 -Port 5001 -WarningAction SilentlyContinue
    if ($t.TcpTestSucceeded) { break }
  } catch {}
  Start-Sleep -Seconds 1
  $elapsed++
  if ($elapsed -ge $maxWaitSeconds) {
    Write-Host "❌ Backend did not start within $maxWaitSeconds seconds. Check $LogsDir/backend.log" -ForegroundColor Red
    break
  }
}
if ($elapsed -lt $maxWaitSeconds) {
  Write-Host "🟢 Backend is up on 127.0.0.1:5001"
}

# Seed once: run scraper in a new window (optional)
$scraperCmd = "cd `"$BackendDir`"; Write-Host '🌱 Seeding: running scraper once...'; npm run scrape 2>&1 | Tee-Object -FilePath `"$LogsDir/scraper.log`" -Append"
Start-Process powershell -ArgumentList "-NoExit", "-Command", $scraperCmd -WindowStyle Normal

# Start frontend in a new window
$frontendCmd = "cd `"$FrontendDir`"; Write-Host '🎨 Starting Frontend (dev)...'; npm run dev 2>&1 | Tee-Object -FilePath `"$LogsDir/frontend.log`" -Append"
Start-Process powershell -ArgumentList "-NoExit", "-Command", $frontendCmd -WindowStyle Normal

Write-Host "🟢 Tous les services sont lancés ! Backend (cron) + Frontend (dev)." -ForegroundColor Green
Write-Host "UI: http://localhost:3000  |  API: http://127.0.0.1:5001/api/news"
