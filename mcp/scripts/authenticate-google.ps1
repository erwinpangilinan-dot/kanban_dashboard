#Requires -Version 5.1
<#
.SYNOPSIS
  Run manage_accounts authenticate against google-workspace MCP (Windows).
#>
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Set-Location $Root

$nodeDir = "C:\Program Files\nodejs"
if (Test-Path $nodeDir) { $env:Path = "$nodeDir;" + $env:Path }

# Load .env
$envFile = Join-Path $Root ".env"
if (Test-Path $envFile) {
  Get-Content $envFile | ForEach-Object {
    $line = $_.Trim()
    if ($line -eq "" -or $line.StartsWith("#")) { return }
    $eq = $line.IndexOf("=")
    if ($eq -lt 1) { return }
    $name = $line.Substring(0, $eq).Trim()
    $value = $line.Substring($eq + 1).Trim().Trim('"').Trim("'")
    [Environment]::SetEnvironmentVariable($name, $value, "Process")
  }
}

if (-not $env:GOOGLE_CLIENT_ID -or -not $env:GOOGLE_CLIENT_SECRET) {
  Write-Error "GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET required in .env"
}

$npxCmd = Join-Path $nodeDir "npx.cmd"
if (-not (Test-Path $npxCmd)) { $npxCmd = "npx" }

Write-Host "Starting google-workspace MCP and calling manage_accounts authenticate..." -ForegroundColor Cyan
Write-Host "A browser window should open. Complete Google sign-in, then return here." -ForegroundColor Yellow

$psi = New-Object System.Diagnostics.ProcessStartInfo
$psi.FileName = $npxCmd
$psi.Arguments = "-y @aaronsb/google-workspace-mcp"
$psi.WorkingDirectory = $Root
$psi.UseShellExecute = $false
$psi.RedirectStandardInput = $true
$psi.RedirectStandardOutput = $true
$psi.RedirectStandardError = $true
$psi.CreateNoWindow = $true
$psi.EnvironmentVariables["GOOGLE_CLIENT_ID"] = $env:GOOGLE_CLIENT_ID
$psi.EnvironmentVariables["GOOGLE_CLIENT_SECRET"] = $env:GOOGLE_CLIENT_SECRET
if ($env:GOOGLE_REFRESH_TOKEN) {
  $psi.EnvironmentVariables["GOOGLE_REFRESH_TOKEN"] = $env:GOOGLE_REFRESH_TOKEN
}

$proc = [Diagnostics.Process]::Start($psi)
$stderrBuilder = New-Object System.Text.StringBuilder
$stdoutQueue = [System.Collections.Concurrent.ConcurrentQueue[string]]::new()

$errHandler = {
  if (-not [string]::IsNullOrEmpty($EventArgs.Data)) {
    [void]$Event.MessageData.AppendLine($EventArgs.Data)
    [Console]::Error.WriteLine($EventArgs.Data)
  }
}
$null = Register-ObjectEvent -InputObject $proc -EventName ErrorDataReceived -Action {
  if ($EventArgs.Data) { [Console]::Error.WriteLine($EventArgs.Data) }
} -MessageData $stderrBuilder
$proc.BeginErrorReadLine()

function Send-Msg($obj) {
  $line = ($obj | ConvertTo-Json -Compress -Depth 20)
  $proc.StandardInput.WriteLine($line)
}

$responses = @{}
$buffer = ""

$outJob = Start-Job -ScriptBlock {
  param($stdout)
  while ($null -ne ($line = $stdout.ReadLine())) {
    $line
  }
} -ArgumentList $proc.StandardOutput

Send-Msg @{
  jsonrpc = "2.0"
  id = 1
  method = "initialize"
  params = @{
    protocolVersion = "2024-11-05"
    capabilities = @{}
    clientInfo = @{ name = "authenticate-google-ps1"; version = "1.0.0" }
  }
}
Start-Sleep -Milliseconds 800
Send-Msg @{ jsonrpc = "2.0"; method = "notifications/initialized" }
Send-Msg @{
  jsonrpc = "2.0"
  id = 2
  method = "tools/call"
  params = @{
    name = "manage_accounts"
    arguments = @{ operation = "authenticate" }
  }
}

$deadline = (Get-Date).AddMinutes(5)
$got = $null
while ((Get-Date) -lt $deadline) {
  $lines = Receive-Job $outJob -ErrorAction SilentlyContinue
  foreach ($line in $lines) {
    if (-not $line) { continue }
    try {
      $msg = $line | ConvertFrom-Json
      if ($msg.id -eq 2) { $got = $msg; break }
      if ($msg.result.content) {
        foreach ($part in $msg.result.content) {
          if ($part.type -eq "text") { Write-Host $part.text }
        }
      }
    } catch {}
  }
  if ($got) { break }
  if ($proc.HasExited) { break }
  Start-Sleep -Milliseconds 200
}

Stop-Job $outJob -ErrorAction SilentlyContinue
Remove-Job $outJob -Force -ErrorAction SilentlyContinue
if (-not $proc.HasExited) { $proc.Kill() }

if (-not $got) {
  Write-Error "Timed out or MCP exited before authenticate completed. Check stderr above."
}

if ($got.error) {
  Write-Error ("Authentication failed: " + ($got.error | ConvertTo-Json -Compress))
}

if ($got.result.content) {
  foreach ($part in $got.result.content) {
    if ($part.type -eq "text") { Write-Host "`n$($part.text)`n" }
  }
}

Write-Host "Done. If auth succeeded, sync tokens into .env next." -ForegroundColor Green
