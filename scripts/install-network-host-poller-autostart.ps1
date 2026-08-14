#Requires -Version 5.1
<#
.SYNOPSIS
  Register a per-user Scheduled Task so the host poller starts at logon
  and is re-checked every 10 minutes while Docker is up.
#>
param(
  [switch]$Quiet,
  [switch]$Unregister
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$taskName = "MissionControlNetworkHostPoller"
$starter = Join-Path $PSScriptRoot "ensure-network-host-poller.ps1"

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
$triggerLogon.Delay = 'PT3M'

# -Once + Repetition* is the PS 5.1-compatible way to get a recurring nudge
$triggerRepeat = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) `
  -RepetitionInterval (New-TimeSpan -Minutes 10) `
  -RepetitionDuration (New-TimeSpan -Days 3650)

$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -StartWhenAvailable `
  -ExecutionTimeLimit (New-TimeSpan -Hours 1)

$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited

Register-ScheduledTask `
  -TaskName $taskName `
  -Action $action `
  -Trigger @($triggerLogon, $triggerRepeat) `
  -Settings $settings `
  -Principal $principal `
  -Force | Out-Null

if (-not $Quiet) {
  Write-Host "Scheduled task '$taskName' registered (3 min after logon + every 10 min)." -ForegroundColor Green
  Write-Host "Requires Docker Desktop set to start with Windows for full auto-recovery." -ForegroundColor Gray
}
