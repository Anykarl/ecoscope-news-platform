# Récupérer le dernier log de scraping
$log = Get-ChildItem .\logs\scrape-*.log | Sort-Object LastWriteTime -Descending | Select-Object -First 1
$logContent = Get-Content -Path $log.FullName -Raw
$diagnosticContent = @()

# Motifs regex pour extraire les marqueurs du log
$patterns = @{
    "RAW_COUNT" = 'RAW_COUNT=(\d+)'
    "SKIPPED_COUNT" = 'SKIPPED_COUNT=(\d+)'
    "DEDUP_COUNT" = 'DEDUP_COUNT=(\d+)'
    "ENRICH_CAP_USED" = 'ENRICH_CAP_USED=(\d+)'
    "POST_SUMMARY" = 'POST_SUMMARY=(.+)'
    "SRC_SUMMARY" = 'SRC_SUMMARY=(.+)'
}

# Extraire chaque marqueur s'il est présent
foreach ($key in $patterns.Keys) {
    if ($logContent -match $patterns[$key]) {
        $diagnosticContent += "$key=$($Matches[1])"
    }
}

# Enregistrer le diagnostic extrait dans un fichier
$diagnosticFile = ".\logs\diagnostic-test.txt"
$diagnosticContent | Out-File $diagnosticFile -Encoding UTF8

# Message de confirmation et affichage rapide du contenu
Write-Host "Diagnostic généré dans $diagnosticFile avec $($diagnosticContent.Count) indicateurs"
Get-Content $diagnosticFile | ForEach-Object { Write-Host $_ }
