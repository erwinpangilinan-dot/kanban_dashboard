#Requires -Version 5.1
<#
.SYNOPSIS
  Chunk + ingest a MOP markdown file into Memoria (LAN).
#>
param(
  [Parameter(Mandatory = $true)]
  [string]$Source,
  [string]$MemoriaUrl = "http://10.10.50.2:8765",
  [string]$OutRoot = ""
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
if (-not $OutRoot) { $OutRoot = Join-Path $Root "scripts\mop\out" }

$env:Path = "C:\Program Files\nodejs;" + $env:Path
$env:MEMORIA_API_URL = $MemoriaUrl

Push-Location $Root
try {
  Write-Host "Chunking $Source ..." -ForegroundColor Cyan
  node scripts/mop/chunk-mop.js $Source --out $OutRoot
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

  $base = [IO.Path]::GetFileNameWithoutExtension((Resolve-Path $Source))
  $chunkDir = Get-ChildItem -Path $OutRoot -Directory | Sort-Object LastWriteTime -Descending | Select-Object -First 1
  if (-not $chunkDir) { throw "No chunk output directory under $OutRoot" }

  Write-Host "Ingesting $($chunkDir.FullName) → $MemoriaUrl ..." -ForegroundColor Cyan
  node scripts/mop/ingest-mop.js $chunkDir.FullName
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

  Write-Host "Generating skill draft ..." -ForegroundColor Cyan
  node scripts/mop/mop-to-skill.js --from-dir $chunkDir.FullName
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

  Write-Host "Done." -ForegroundColor Green
} finally {
  Pop-Location
}
