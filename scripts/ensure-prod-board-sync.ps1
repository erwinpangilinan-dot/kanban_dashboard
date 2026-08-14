#Requires -Version 5.1
<#
.SYNOPSIS
  Run prod→local board sync when Docker Postgres is up.
  Used by the logon / interval scheduled task.
#>
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

function Test-DockerDbUp {
  try {
    $running = docker inspect -f "{{.State.Running}}" mission_control_db 2>$null
    return $running -eq "true"
  } catch {
    return $false
  }
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

if (-not (Test-DockerDbUp)) { exit 0 }
if (-not (Test-PostgresReady)) { exit 0 }

& (Join-Path $PSScriptRoot "sync-prod-boards-to-local.ps1") -Quiet
exit $LASTEXITCODE
