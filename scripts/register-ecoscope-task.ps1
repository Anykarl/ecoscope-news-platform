param(
  [string]$ProjectRoot = (Split-Path -Parent $MyInvocation.MyCommand.Path | Split-Path -Parent),
  [string]$DailyAt = "03:00",
  [string]$TaskName = "EcoScope-Daily-Run"
)

$ErrorActionPreference = 'Stop'
$scriptPath = Join-Path $ProjectRoot 'auto-ecoscope-test.ps1'
if (-not (Test-Path $scriptPath)) { throw "Script introuvable: $scriptPath" }

$action = New-ScheduledTaskAction -Execute "PowerShell.exe" -Argument "-ExecutionPolicy Bypass -File `"$scriptPath`" -VerboseMode"
$trigger = New-ScheduledTaskTrigger -Daily -At $DailyAt
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries

Register-ScheduledTask -TaskName $TaskName -Trigger $trigger -Action $action -Settings $settings -Description "Exécution quotidienne automatique du pipeline EcoScope" -Force

Write-Host "Tâche planifiée '$TaskName' enregistrée pour $DailyAt."
