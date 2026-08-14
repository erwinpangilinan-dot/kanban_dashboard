#Requires -Version 5.1
<#
.SYNOPSIS
  Keep the network host poller (+ reboot agent) running while Docker is up.
  Restarts on crash. Exits when stop sentinel is present.
#>
param(
  [switch]$Once
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

$logsDir = Join-Path $Root "logs"
if (-not (Test-Path $logsDir)) { New-Item -ItemType Directory -Path $logsDir | Out-Null }

$logFile = Join-Path $logsDir "network-host-poller.log"
$pidFile = Join-Path $logsDir "network-host-poller.pid"
$stopFile = Join-Path $logsDir "network-host-poller.stop"
$pollerJs = Join-Path $Root "backend\scripts\network-host-poller.js"

function Write-PollerLog([string]$Message) {
  $line = "[{0}] {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $Message
  Add-Content -Path $logFile -Value $line
  Write-Host $line
}

function Test-PostgresReady {
  try {
    $tcp = New-Object System.Net.Sockets.TcpClient
    $iar = $tcp.BeginConnect("127.0.0.1", 5432, $null, $null)
    $ok = $iar.AsyncWaitHandle.WaitOne(1500, $false)
    if (-not $ok) {
      $tcp.Close()
      return $false
    }
    $tcp.EndConnect($iar)
    $tcp.Close()
    return $true
  } catch {
    return $false
  }
}

function Stop-ExistingPollerNodes {
  Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -and $_.CommandLine -like "*network-host-poller.js*" } |
    ForEach-Object {
      Write-PollerLog "Stopping stale poller PID $($_.ProcessId)"
      Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
    }
}

if (Test-Path $stopFile) { Remove-Item $stopFile -Force -ErrorAction SilentlyContinue }

$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
  Write-PollerLog "ERROR: Node.js not found on PATH"
  exit 1
}

if (-not (Test-Path (Join-Path $Root "backend\node_modules"))) {
  Write-PollerLog "Installing backend dependencies for host poller..."
  Push-Location (Join-Path $Root "backend")
  npm ci --omit=dev
  if ($LASTEXITCODE -ne 0) { npm install --omit=dev }
  Pop-Location
}

$env:NETWORK_HOST_DATABASE_URL = "postgresql://kanban:kanban@localhost:5432/mission_control"
$env:NETWORK_SKIP_CONTAINER_POLLER = "0"
Remove-Item Env:NETWORK_REBOOT_VIA_HOST -ErrorAction SilentlyContinue

$supervisorPid = $PID
Set-Content -Path $pidFile -Value $supervisorPid -Encoding ascii
Write-PollerLog "Supervisor started (PID $supervisorPid)"

try {
  while ($true) {
    if (Test-Path $stopFile) {
      Write-PollerLog "Stop sentinel found - exiting supervisor"
      break
    }

    if (-not (Test-PostgresReady)) {
      Write-PollerLog "Waiting for Postgres on 127.0.0.1:5432 (Docker stack)..."
      Start-Sleep -Seconds 5
      if ($Once) { break }
      continue
    }

    Stop-ExistingPollerNodes
    Write-PollerLog "Starting network-host-poller.js (probe + reboot agent :38765)"
    $outLog = Join-Path $logsDir "network-host-poller.out.log"
    $errLog = Join-Path $logsDir "network-host-poller.err.log"
    $proc = Start-Process -FilePath $node.Source -ArgumentList @($pollerJs) `
      -WorkingDirectory $Root -PassThru -WindowStyle Hidden `
      -RedirectStandardOutput $outLog `
      -RedirectStandardError $errLog

    while (-not $proc.HasExited) {
      if (Test-Path $stopFile) {
        Write-PollerLog "Stop requested - killing poller PID $($proc.Id)"
        Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
        break
      }
      Start-Sleep -Seconds 2
    }

    if ($null -ne $proc.ExitCode) {
      $code = $proc.ExitCode
    } else {
      $code = "n/a"
    }
    Write-PollerLog "Poller exited (code $code)"

    if ($Once) { break }
    if (Test-Path $stopFile) { break }

    Write-PollerLog "Restarting in 5s..."
    Start-Sleep -Seconds 5
  }
} catch {
  Write-PollerLog ("Supervisor error: " + $_.Exception.Message)
  throw
} finally {
  Stop-ExistingPollerNodes
  if (Test-Path $pidFile) {
    $current = (Get-Content $pidFile -Raw).Trim()
    if ($current -eq "$supervisorPid") {
      Remove-Item $pidFile -Force -ErrorAction SilentlyContinue
    }
  }
  Write-PollerLog "Supervisor stopped"
}
