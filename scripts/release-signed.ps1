param(
  [string]$OutDir = "release-check",
  [string]$UpdaterUrl = "https://github.com/neko233-com/markdown233/releases/latest/download/latest.json"
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$out = Join-Path $root $OutDir

function Require-Env($name) {
  if (-not [Environment]::GetEnvironmentVariable($name)) {
    throw "Missing required environment variable: $name"
  }
}

Require-Env "TAURI_SIGNING_PRIVATE_KEY"
Require-Env "TAURI_SIGNING_PRIVATE_KEY_PASSWORD"

if ($IsWindows -or $env:OS -eq "Windows_NT") {
  if (-not $env:WINDOWS_SIGN_CERT_PATH -and -not $env:WINDOWS_SIGN_CERT_THUMBPRINT) {
    Write-Warning "Windows Authenticode certificate not configured. Set WINDOWS_SIGN_CERT_PATH or WINDOWS_SIGN_CERT_THUMBPRINT for production signing."
  }
}

if ($IsMacOS) {
  Require-Env "APPLE_SIGNING_IDENTITY"
  Require-Env "APPLE_ID"
  Require-Env "APPLE_PASSWORD"
  Require-Env "APPLE_TEAM_ID"
}

Set-Location $root
New-Item -ItemType Directory -Force -Path $out | Out-Null

npm ci
if ($LASTEXITCODE -ne 0) { throw "npm ci failed" }

npx tauri build
if ($LASTEXITCODE -ne 0) { throw "tauri build failed" }

$version = (Get-Content package.json | ConvertFrom-Json).version
$manifest = @{
  version = $version
  notes = "Markdown233 $version"
  pub_date = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
  platforms = @{}
  updater_url = $UpdaterUrl
}

$latestPath = Join-Path $out "latest.json"
$manifest | ConvertTo-Json -Depth 8 | Set-Content -Encoding utf8 $latestPath
Write-Host "Signed release build finished. Fill platform URLs/signatures in $latestPath after upload."
