#Requires -Version 5.1
<#
.SYNOPSIS
  Sync Mission Control projects/boards from production (10.10.50.6) into local Docker DB.
#>
param(
  [switch]$Quiet
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

$logsDir = Join-Path $Root "logs"
if (-not (Test-Path $logsDir)) { New-Item -ItemType Directory -Path $logsDir | Out-Null }
$logFile = Join-Path $logsDir "prod-board-sync.log"

function Write-SyncLog([string]$Message) {
  $line = "[{0}] {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $Message
  Add-Content -Path $logFile -Value $line
  if (-not $Quiet) { Write-Host $line }
}

$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
  Write-SyncLog "ERROR: Node.js not found on PATH"
  exit 1
}

$script = Join-Path $Root "backend\scripts\sync-local-board-from-prod.js"
if (-not (Test-Path $script)) {
  Write-SyncLog "ERROR: Missing $script"
  exit 1
}

$env:DATABASE_URL = "postgresql://kanban:kanban@127.0.0.1:5432/mission_control"
$args = @($script)
if ($Quiet) { $args += "--quiet" }

try {
  $out = & $node.Source @args 2>&1
  $text = ($out | Out-String).Trim()
  if ($LASTEXITCODE -ne 0) {
    Write-SyncLog "ERROR: sync failed (exit $LASTEXITCODE): $text"
    exit $LASTEXITCODE
  }
  Write-SyncLog "OK: $text"
  exit 0
} catch {
  Write-SyncLog "ERROR: $($_.Exception.Message)"
  exit 1
}
