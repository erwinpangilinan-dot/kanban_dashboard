#Requires -Version 5.1
<#
.SYNOPSIS
  Tail Mission Control Docker logs (Windows override).
#>
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

Write-Host "Docker logs (Ctrl+C to stop). Host poller: logs\network-host-poller.log" -ForegroundColor Cyan
& docker compose -f docker-compose.yml -f docker-compose.windows.yml logs -f @args
exit $LASTEXITCODE