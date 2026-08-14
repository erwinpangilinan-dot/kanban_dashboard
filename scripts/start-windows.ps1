#Requires -Version 5.1
<#
.SYNOPSIS
  Build and start Mission Control with the Windows Docker Compose override,
  then start the host network poller supervisor (BMC IPv6 + reboot agent).
#>
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

$setup = Join-Path $PSScriptRoot "setup-windows.ps1"
& $setup
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "`nStarting stack (postgres + api + web)..." -ForegroundColor Cyan
& docker compose -f docker-compose.yml -f docker-compose.windows.yml up -d --build
if ($LASTEXITCODE -ne 0) {
  Write-Error "docker compose up failed (exit $LASTEXITCODE)"
}

Write-Host "Waiting for Postgres to be healthy..." -ForegroundColor Cyan
$deadline = (Get-Date).AddMinutes(2)
do {
  $pg = docker inspect -f "{{.State.Health.Status}}" mission_control_db 2>$null
  if ($pg -eq "healthy") { break }
  Start-Sleep -Seconds 2
} while ((Get-Date) -lt $deadline)

if ($pg -ne "healthy") {
  Write-Warning "Postgres not healthy yet; host poller will keep retrying."
}

# BMC IPv6 is reachable from Windows but usually not from Docker Desktop containers.
& (Join-Path $PSScriptRoot "start-network-host-poller.ps1")

# Ensure poller comes back after Windows / Docker Desktop reboot (idempotent).
$autostart = Join-Path $PSScriptRoot "install-network-host-poller-autostart.ps1"
if (Test-Path $autostart) {
  & $autostart -Quiet
}

# Keep local Kanban projects in sync with production Mission Control (10.10.50.6).
$boardSync = Join-Path $PSScriptRoot "install-prod-board-sync-autostart.ps1"
if (Test-Path $boardSync) {
  & $boardSync -Quiet
}
& (Join-Path $PSScriptRoot "sync-prod-boards-to-local.ps1") -Quiet

Write-Host @"

Stack is up. Open http://localhost
Network tab: vDU BMC status (host poller probes IPv6 + reboot agent)
Projects: auto-synced from http://10.10.50.6 every 5 min

Useful commands:
  .\scripts\logs-windows.ps1
  .\scripts\stop-windows.ps1
  .\scripts\start-network-host-poller.ps1
  .\scripts\stop-network-host-poller.ps1
  .\scripts\sync-prod-boards-to-local.ps1
"@ -ForegroundColor Green
