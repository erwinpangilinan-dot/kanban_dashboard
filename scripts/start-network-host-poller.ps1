#Requires -Version 5.1
<#
.SYNOPSIS
  Start the BMC Redfish host poller supervisor (auto-restarts; reboot agent :38765).
#>
param(
  [switch]$Foreground
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$supervisor = Join-Path $PSScriptRoot "network-host-poller-supervisor.ps1"
$logsDir = Join-Path $Root "logs"
$stopFile = Join-Path $logsDir "network-host-poller.stop"
$pidFile = Join-Path $logsDir "network-host-poller.pid"

if (-not (Test-Path $logsDir)) { New-Item -ItemType Directory -Path $logsDir | Out-Null }
if (Test-Path $stopFile) { Remove-Item $stopFile -Force -ErrorAction SilentlyContinue }

# Stop any prior supervisor / poller
if (Test-Path $pidFile) {
  $old = (Get-Content $pidFile -Raw -ErrorAction SilentlyContinue).Trim()
  if ($old -match '^\d+$') {
    Stop-Process -Id ([int]$old) -Force -ErrorAction SilentlyContinue
  }
}
Get-CimInstance Win32_Process -Filter "Name = 'powershell.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -and $_.CommandLine -like "*network-host-poller-supervisor.ps1*" } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -and $_.CommandLine -like "*network-host-poller.js*" } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }

if ($Foreground) {
  & $supervisor
  exit $LASTEXITCODE
}

Start-Process -FilePath "powershell.exe" -ArgumentList @(
  "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $supervisor
) -WorkingDirectory $Root -WindowStyle Hidden

Start-Sleep -Seconds 2
try {
  $health = (Invoke-WebRequest -Uri "http://127.0.0.1:38765/health" -UseBasicParsing -TimeoutSec 3).Content
  Write-Host "Network host poller running: $health" -ForegroundColor Green
} catch {
  Write-Host "Network host poller supervisor started (agent may still be waiting for Postgres). Logs: logs\network-host-poller.log" -ForegroundColor Cyan
}
