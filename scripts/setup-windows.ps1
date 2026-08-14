#Requires -Version 5.1
<#
.SYNOPSIS
  Prepare Mission Control for Docker Desktop on Windows.
#>
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

function Test-DockerReady {
  try {
    $null = & docker info 2>$null
    return ($LASTEXITCODE -eq 0)
  } catch {
    return $false
  }
}

Write-Host "Mission Control - Windows setup" -ForegroundColor Cyan
Write-Host "Project root: $Root"

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
  Write-Host @"

Docker was not found on PATH.
Install Docker Desktop (WSL2 backend), then re-run this script:

  winget install --id Docker.DockerDesktop -e

After install, start Docker Desktop and wait until it is running.
"@ -ForegroundColor Yellow
  exit 1
}

if (-not (Test-DockerReady)) {
  Write-Host @"

Docker CLI is present but the engine is not ready.
Start Docker Desktop and wait until the whale icon shows 'Docker Desktop is running',
then re-run this script.
"@ -ForegroundColor Yellow
  exit 1
}

$envExample = Join-Path $Root ".env.example"
$envFile = Join-Path $Root ".env"
if (-not (Test-Path $envFile)) {
  if (-not (Test-Path $envExample)) {
    Write-Error "Missing .env.example - cannot create .env"
  }
  Copy-Item $envExample $envFile
  Write-Host "Created .env from .env.example" -ForegroundColor Green
} else {
  Write-Host ".env already exists - left unchanged"
}

# Prefer direct host Ollama on Windows (no socat proxy)
$envContent = Get-Content $envFile -Raw
if ($envContent -match '(?m)^OLLAMA_BASE_URL=http://host\.docker\.internal:11435\s*$') {
  $envContent = $envContent -replace '(?m)^OLLAMA_BASE_URL=http://host\.docker\.internal:11435\s*$', 'OLLAMA_BASE_URL=http://host.docker.internal:11434'
  Set-Content -Path $envFile -Value $envContent -NoNewline
  Write-Host "Updated OLLAMA_BASE_URL in .env for Docker Desktop (port 11434)" -ForegroundColor Green
}

# The host agent refuses to start without a shared secret; generate one on first setup.
$envContent = Get-Content $envFile -Raw
if ($envContent -match '(?m)^NETWORK_HOST_AGENT_TOKEN=\s*$') {
  $bytes = New-Object byte[] 32
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  $token = ($bytes | ForEach-Object { $_.ToString("x2") }) -join ""
  $envContent = $envContent -replace '(?m)^NETWORK_HOST_AGENT_TOKEN=\s*$', "NETWORK_HOST_AGENT_TOKEN=$token"
  Set-Content -Path $envFile -Value $envContent -NoNewline
  Write-Host "Generated NETWORK_HOST_AGENT_TOKEN in .env" -ForegroundColor Green
}

Write-Host @"

Setup complete. Next:

  .\scripts\start-windows.ps1

Then open http://localhost

Notes:
  * Local Docker DB is separate from production (http://10.10.50.6).
  * Email assistant needs Ollama on the host (optional).
  * For Cursor MCP on Windows, see .cursor/mcp.windows.json
"@ -ForegroundColor Green