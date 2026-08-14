#Requires -Version 5.1
<#
.SYNOPSIS
  Launch Google Workspace MCP (Windows). Equivalent to mcp/run-google-workspace.sh.
#>
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot

# Ensure Node is on PATH even when Cursor was started before Node install
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

if (-not $env:GOOGLE_CLIENT_ID -or -not $env:GOOGLE_CLIENT_SECRET) {
  Write-Error "GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET required in .env"
}

$npxCmd = Join-Path $nodeDir "npx.cmd"
if (-not (Test-Path $npxCmd)) {
  $npxCmd = "npx"
}

Set-Location $Root
& $npxCmd -y @aaronsb/google-workspace-mcp
exit $LASTEXITCODE
