Write-Host "🌱 Démarrage d'EcoScope..." -ForegroundColor Green

# Vérification Node.js
if (-not (Get-Command "node" -ErrorAction SilentlyContinue)) {
  Write-Host "❌ Node.js n'est pas installé!" -ForegroundColor Red
  Write-Host "Téléchargez-le depuis: https://nodejs.org" -ForegroundColor Yellow
  exit 1
}
if (-not (Get-Command "npm" -ErrorAction SilentlyContinue)) {
  Write-Host "❌ npm n'est pas disponible!" -ForegroundColor Red
  Write-Host "Installez Node.js (inclut npm): https://nodejs.org" -ForegroundColor Yellow
  exit 1
}

# Répertoires
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$backendDir = Join-Path $root 'backend'
$frontendDir = Join-Path $root 'frontend'

# Variable d'environnement pour le frontend (URL backend)
$env:VITE_API_URL = "http://localhost:5002"

# Crée .env.local si absent
$envFile = Join-Path $frontendDir '.env.local'
if (-not (Test-Path $envFile)) {
  Write-Host "Création du fichier de configuration (.env.local)..." -ForegroundColor Yellow
  "VITE_API_URL=http://localhost:5002" | Out-File -FilePath $envFile -Encoding UTF8 -Force
}

# Installer les dépendances si besoin
if (-not (Test-Path (Join-Path $frontendDir 'node_modules'))) {
  Write-Host "Installation des dépendances frontend..." -ForegroundColor Yellow
  npm install --prefix $frontendDir
}
if (-not (Test-Path (Join-Path $backendDir 'node_modules'))) {
  Write-Host "Installation des dépendances backend..." -ForegroundColor Yellow
  npm install --prefix $backendDir
}

# Démarrage du backend
Write-Host "Starting backend on port 5002..." -ForegroundColor Yellow
Start-Process -NoNewWindow -FilePath "node" -ArgumentList "server.js" -WorkingDirectory $backendDir

# Attente courte
Start-Sleep -Seconds 3

# Démarrage du frontend (Vite port 3000 via package.json)
Write-Host "Starting frontend on port 3000..." -ForegroundColor Yellow
# Utilise cmd.exe pour garantir l'exécution de npm.cmd sur Windows
Start-Process -NoNewWindow -FilePath "cmd.exe" -ArgumentList "/c","npm","run","dev" -WorkingDirectory $frontendDir

Write-Host "✅ EcoScope est en cours de démarrage..." -ForegroundColor Green
Write-Host "Frontend: http://localhost:3000" -ForegroundColor Cyan
Write-Host "Backend:  http://localhost:5002" -ForegroundColor Cyan

# Vérifications de connectivité ajoutées le $(Get-Date -Format "yyyy-MM-dd")
Write-Host "`nVérification de la connectivité..." -ForegroundColor Yellow

# Test du backend /health
try {
  $healthResponse = Invoke-WebRequest -Uri "http://localhost:5002/health" -UseBasicParsing -ErrorAction Stop
  Write-Host "✅ Backend health: $($healthResponse.StatusCode)" -ForegroundColor Green
} catch {
  Write-Host "❌ Backend health: Erreur de connexion" -ForegroundColor Red
  Write-Host "   Message: $($_.Exception.Message)" -ForegroundColor Yellow
}

# Test des articles /api/news
try {
  $newsResponse = Invoke-WebRequest -Uri "http://localhost:5002/api/news" -UseBasicParsing -ErrorAction Stop
  Write-Host "✅ API articles: $($newsResponse.StatusCode)" -ForegroundColor Green
} catch {
  Write-Host "❌ API articles: Erreur de connexion" -ForegroundColor Red
  Write-Host "   Message: $($_.Exception.Message)" -ForegroundColor Yellow
}

# Test du frontend
try {
  $frontendResponse = Invoke-WebRequest -Uri "http://localhost:3000" -UseBasicParsing -ErrorAction Stop
  Write-Host "✅ Frontend: $($frontendResponse.StatusCode)" -ForegroundColor Green
} catch {
  Write-Host "❌ Frontend: Erreur de connexion" -ForegroundColor Red
  Write-Host "   Message: $($_.Exception.Message)" -ForegroundColor Yellow
}
