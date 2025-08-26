# scripts/clean-ports.ps1 - Version mise à jour
$ports = 5001, 5002, 5003, 5004, 5005, 3000

Write-Host "Nettoyage des ports: $($ports -join ', ')"

foreach ($port in $ports) {
    try {
        $processes = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
        foreach ($process in $processes) {
            $processId = $process.OwningProcess
            $processName = (Get-Process -Id $processId -ErrorAction SilentlyContinue).Name
            Write-Host "Arrêt du processus $processName (PID: $processId) sur le port $port"
            Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue
        }
    }
    catch {
        Write-Host "Erreur lors du traitement du port $port : $($_.Exception.Message)"
    }
}

Write-Host "Nettoyage des ports terminé"
