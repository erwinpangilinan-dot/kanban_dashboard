#Requires -Version 5.1
<#
.SYNOPSIS
  Register a per-user Scheduled Task so production Mission Control boards
  sync into the local Docker DB after logon and every 5 minutes.
#>
param(
  [switch]$Quiet,
  [switch]$Unregister
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$taskName = "MissionControlProdBoardSync"
$starter = Join-Path $PSScriptRoot "ensure-prod-board-sync.ps1"

if ($Unregister) {
  Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
  if (-not $Quiet) { Write-Host "Removed scheduled task $taskName" -ForegroundColor Green }
  exit 0
}

if (-not (Test-Path $starter)) {
  Write-Error "Missing $starter"
}

$arg = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$starter`""
$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument $arg -WorkingDirectory $Root

$triggerLogon = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$triggerLogon.Delay = 'PT4M'

$triggerRepeat = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) `
  -RepetitionInterval (New-TimeSpan -Minutes 5) `
  -RepetitionDuration (New-TimeSpan -Days 3650)

$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -StartWhenAvailable `
  -ExecutionTimeLimit (New-TimeSpan -Minutes 10)

$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited

Register-ScheduledTask `
  -TaskName $taskName `
  -Action $action `
  -Trigger @($triggerLogon, $triggerRepeat) `
  -Settings $settings `
  -Principal $principal `
  -Force | Out-Null

if (-not $Quiet) {
  Write-Host "Scheduled task '$taskName' registered (4 min after logon + every 5 min)." -ForegroundColor Green
  Write-Host "Syncs http://10.10.50.6 projects → local Docker DB. Logs: logs\prod-board-sync.log" -ForegroundColor Gray
}
