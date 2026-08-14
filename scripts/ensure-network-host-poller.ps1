#Requires -Version 5.1
<#
.SYNOPSIS
  Start the host poller if Docker Postgres is up and the agent is not healthy.
  Used by the logon / interval scheduled task. Waits for Docker Desktop + stack
  after a PC reboot (up to ~10 minutes).
#>
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

$MaxWaitSec = 600
$PollSec = 15

function Test-AgentHealthy {
  try {
    $r = Invoke-WebRequest -Uri "http://127.0.0.1:38765/health" -UseBasicParsing -TimeoutSec 2
    return $r.StatusCode -eq 200
  } catch {
    return $false
  }
}

function Test-DockerReady {
  try {
    $null = docker info 2>$null
    return ($LASTEXITCODE -eq 0)
  } catch {
    return $false
  }
}

function Test-DockerDbUp {
  try {
    $running = docker inspect -f "{{.State.Running}}" mission_control_db 2>$null
    return $running -eq "true"
  } catch {
    return $false
  }
}

function Start-DockerStackIfNeeded {
  if (Test-DockerDbUp) { return $true }
  if (-not (Test-DockerReady)) { return $false }

  $compose = @(
    "compose", "-f", "docker-compose.yml", "-f", "docker-compose.windows.yml",
    "up", "-d", "postgres", "api", "web"
  )
  & docker @compose 2>$null | Out-Null
  Start-Sleep -Seconds 5
  return (Test-DockerDbUp)
}

if (Test-AgentHealthy) {
  exit 0
}

$deadline = (Get-Date).AddSeconds($MaxWaitSec)
while ((Get-Date) -lt $deadline) {
  if (Test-AgentHealthy) {
    exit 0
  }

  if (Test-DockerDbUp -or (Start-DockerStackIfNeeded)) {
    break
  }

  Start-Sleep -Seconds $PollSec
}

if (-not (Test-DockerDbUp)) {
  # Stack not running — nothing to poll yet
  exit 0
}

if (Test-AgentHealthy) {
  exit 0
}

& (Join-Path $PSScriptRoot "start-network-host-poller.ps1")
exit 0
