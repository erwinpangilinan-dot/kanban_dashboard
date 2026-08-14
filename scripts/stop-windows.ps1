#Requires -Version 5.1
<#
.SYNOPSIS
  Stop Mission Control Docker stack and the Windows host network poller.
#>
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

Write-Host "Stopping network host poller..." -ForegroundColor Cyan
& (Join-Path $PSScriptRoot "stop-network-host-poller.ps1")

Write-Host "Stopping Mission Control Docker stack..." -ForegroundColor Cyan
& docker compose -f docker-compose.yml -f docker-compose.windows.yml down
if ($LASTEXITCODE -ne 0) {
  Write-Error "docker compose down failed (exit $LASTEXITCODE)"
}
Write-Host "Stopped." -ForegroundColor Green
