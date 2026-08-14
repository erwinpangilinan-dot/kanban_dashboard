#Requires -Version 5.1
<#
.SYNOPSIS
  Stop the network host poller supervisor and node process.
#>
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$logsDir = Join-Path $Root "logs"
$stopFile = Join-Path $logsDir "network-host-poller.stop"
$pidFile = Join-Path $logsDir "network-host-poller.pid"

if (-not (Test-Path $logsDir)) { New-Item -ItemType Directory -Path $logsDir | Out-Null }
Set-Content -Path $stopFile -Value (Get-Date -Format o) -Encoding ascii

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

# Give agent port a moment to release
Start-Sleep -Milliseconds 500
Write-Host "Network host poller stopped." -ForegroundColor Green
