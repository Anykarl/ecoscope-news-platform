# EcoScope-Test - Opérations et Automatisation

Ce document décrit comment diagnostiquer, automatiser et superviser EcoScope-Test en utilisant uniquement des outils gratuits intégrés à Windows (PowerShell, Planificateur de tâches, Event Log).

## 1) Diagnostic des échecs d'enrichissement
- Commande pour filtrer les erreurs d'enrichissement dans le log de scraping le plus récent:
```powershell
$log = Get-ChildItem .\logs -Filter 'scrape-*.log' | Sort-Object LastWriteTime -Descending | Select-Object -First 1
Get-Content $log.FullName | Select-String -Pattern 'enrich|enrichissement' -Context 5
```
- Astuces:
  - Rechercher aussi: `POST_SUMMARY`, `ENRICH_CAP_USED`, `SKIPPED_COUNT`, `DEDUP_COUNT`.
  - Si besoin, augmentez temporairement `ENRICH_CAP` via `auto-ecoscope-test.ps1` (variable d'environnement propagée au pipeline) ou paramètre `-EnrichCap` de `scripts/run-sequence.ps1`.

## 2) Automatisation planifiée (gratuite)
- Script fourni: `scripts/register-ecoscope-task.ps1`.
- Créer une tâche quotidienne à 03:00:
```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\register-ecoscope-task.ps1 -DailyAt "03:00" -TaskName "EcoScope-Daily-Run"
```
- La tâche lance `auto-ecoscope-test.ps1` (cron backend désactivé par défaut), exécute le pipeline complet, génère logs/diagnostic/backup/commit.
- Pour modifier l'heure: ajuster `-DailyAt` (format HH:mm).

## 3) Amélioration des diagnostics (déjà intégrée)
Le fichier `scripts/run-sequence.ps1` calcule désormais:
- `RuntimeSeconds`: temps total d'exécution du pipeline.
- `Post success rate`: taux de succès global des POST si dispo.
- `Par source (%)`: part de contribution par source.
- `Contenus: videos=X articles=Y`: répartition (heuristique: source contenant "video").
- Toujours inclus: `Collecte`, `Skipped`, `AprèsDédup`, `ENRICH_CAP_USED`, `POST_SUMMARY`, top raisons et recommandations.

## 4) Monitoring gratuit basé logs
- Script fourni: `scripts/monitor-ecoscope.ps1`.
- Utilisation manuelle:
```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\monitor-ecoscope.ps1
```
- Comportement:
  - Lit `last-run-summary.txt` (généré à chaque run).
  - Cherche des motifs d'erreur: `ERROR`, `ERREUR`, `FAIL`, `EADDRINUSE`, etc.
  - En cas d'anomalie, écrit un événement dans le journal Windows (Application, source EcoScopeMonitor) et retourne code 1.
  - Sinon, log d'information et code 0.
- Planifier le monitoring post-run (exemple):
```powershell
$action = New-ScheduledTaskAction -Execute "PowerShell.exe" -Argument "-ExecutionPolicy Bypass -File `"$PWD\scripts\monitor-ecoscope.ps1`""
$trigger = New-ScheduledTaskTrigger -AtLogOn
Register-ScheduledTask -TaskName "EcoScope-Monitor" -Trigger $trigger -Action $action -Force
```

## 5) Restauration depuis un backup
- Les sauvegardes sont sous `backups/*.zip` et historisées dans `backups/history.txt`.
- Pour restaurer via scripts fournis:
```powershell
cd backend
npm run restore
```
- Pour choisir une sauvegarde "marquée" (via API backend):
  - Écrire le nom dans `backups/selected.json` via endpoint `POST /api/backup/select` ou manuellement.

## 6) Dépannage courant
- Port occupé (EADDRINUSE):
```powershell
Get-NetTCPConnection -LocalPort 5001 -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }
```
- Démarrer le backend sans nodemon (pour stacktrace):
```powershell
cd backend
$env:PORT=5001; $env:BACKEND_PORT=5001; $env:ENABLE_CRON='false'; node server.js
```
- Health-check manuel:
```powershell
Invoke-WebRequest -UseBasicParsing http://127.0.0.1:5001/health
```
- Voir les derniers logs:
```powershell
Get-Content .\logs\backend-manual.log -Tail 200
Get-Content (Get-ChildItem .\logs -Filter 'scrape-*.log' | Sort-Object LastWriteTime -Descending | Select-Object -First 1).FullName -Tail 200
```

## 7) Interprétation des métriques
- `Collecte`/`AprèsDédup`: volume brut vs unique après déduplication inter-sources.
- `Skipped`: éléments filtrés (non-article, live, titres non pertinents, etc.).
- `Post: ok/ko/total`: statut d'envoi au backend.
- `Par source` et `Par source (%)`: répartition des contributions.
- `Contenus videos/articles`: estimation (basée sur noms de source contenant "video").
- `RuntimeSeconds`: durée totale du run (utile pour comparer dans le temps).

## 8) Bonnes pratiques
- Laisser `ENABLE_CRON` à `false` pour les runs automatisés; ne l'activer que pour des runs internes au backend.
- Éviter de surveiller `logs/` et `backups/` dans nodemon (déjà configuré dans `backend/nodemon.json`).
- Tenir les dépendances à jour via `npm install` (géré en début de `run-sequence.ps1`).

---
Pour toute amélioration (nouvelles sources, KPIs additionnels, parsing affiné), ouvrez une issue interne et joignez `logs/` + `last-run-summary.txt`.
