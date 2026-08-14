#Requires -Version 5.1
<#
.SYNOPSIS
  Launch Mission Control MCP server (Windows). Equivalent to mcp/run.sh.
#>
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot

$nodeDir = "C:\Program Files\nodejs"
if (Test-Path $nodeDir) {
  $env:Path = "$nodeDir;" + $env:Path
}

$envFile = Join-Path $Root ".env"
if (Test-Path $envFile) {
  Get-Content $envFile | ForEach-Object {
    $line = $_.Trim()
    if ($line -eq "" -or $line.StartsWith("#")) { return }
    $eq = $line.IndexOf("=")
    if ($eq -lt 1) { return }
    $name = $line.Substring(0, $eq).Trim()
    $value = $line.Substring($eq + 1).Trim()
    if (($value.StartsWith('"') -and $value.EndsWith('"')) -or ($value.StartsWith("'") -and $value.EndsWith("'"))) {
      $value = $value.Substring(1, $value.Length - 2)
    }
    [Environment]::SetEnvironmentVariable($name, $value, "Process")
  }
}

if (-not $env:MISSION_CONTROL_API_URL) {
  $env:MISSION_CONTROL_API_URL = "http://10.10.50.6/api"
}
if (-not $env:MISSION_CONTROL_API_TOKEN -and $env:AUTH_API_TOKEN) {
  $env:MISSION_CONTROL_API_TOKEN = $env:AUTH_API_TOKEN
}
if (-not $env:MISSION_CONTROL_API_TOKEN -and $env:JWT_SECRET) {
  Write-Error "AUTH_API_TOKEN required in .env when JWT_SECRET is set"
}

$node = Join-Path $nodeDir "node.exe"
if (-not (Test-Path $node)) { $node = "node" }

Set-Location $PSScriptRoot
& $node src/index.js
exit $LASTEXITCODE
