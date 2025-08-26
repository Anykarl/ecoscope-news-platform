# scripts/start-all.ps1
Write-Host "Démarrage de l'environnement EcoScope..."
Write-Host "Étape 1: Nettoyage des ports"

# Exécution du script de nettoyage
.\scripts\clean-ports.ps1

Write-Host "Étape 2: Démarrage du backend"
Start-Process -FilePath "cmd.exe" -ArgumentList "/c", "npm", "run", "dev" -WorkingDirectory "backend"

Write-Host "Attente de 10 secondes pour l'initialisation du backend..."
Start-Sleep -Seconds 10

Write-Host "Étape 3: Démarrage du frontend"
Start-Process -FilePath "cmd.exe" -ArgumentList "/c", "npm", "run", "dev" -WorkingDirectory "frontend"

Write-Host "Les services ont été démarrés:"
Write-Host "- Backend: http://localhost:5002"
Write-Host "- Frontend: http://localhost:3000"
