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

if (-not [Environment]::GetEnvironmentVariable("TAURI_SIGNING_PRIVATE_KEY") -and -not [Environment]::GetEnvironmentVariable("TAURI_SIGNING_PRIVATE_KEY_PATH")) {
  throw "Missing required environment variable: TAURI_SIGNING_PRIVATE_KEY or TAURI_SIGNING_PRIVATE_KEY_PATH"
}
Require-Env "TAURI_SIGNING_PRIVATE_KEY_PASSWORD"

if (-not $env:TAURI_SIGNING_PRIVATE_KEY -and $env:TAURI_SIGNING_PRIVATE_KEY_PATH) {
  $env:TAURI_SIGNING_PRIVATE_KEY = Get-Content -Raw -LiteralPath $env:TAURI_SIGNING_PRIVATE_KEY_PATH
}

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
if (-not $env:CARGO_BUILD_JOBS) {
  $env:CARGO_BUILD_JOBS = "1"
}
New-Item -ItemType Directory -Force -Path $out | Out-Null

npm ci
if ($LASTEXITCODE -ne 0) { throw "npm ci failed" }

if ($IsWindows -or $env:OS -eq "Windows_NT") {
  npx tauri build --bundles nsis
} elseif ($IsMacOS) {
  npx tauri build --bundles app,dmg
} else {
  throw "Unsupported OS for signed release."
}
if ($LASTEXITCODE -ne 0) { throw "tauri build failed" }

$version = (Get-Content package.json | ConvertFrom-Json).version
Get-ChildItem -LiteralPath (Join-Path $root "src-tauri/target/release/bundle") -Recurse -File |
  Where-Object { $_.Name -like "*$version*" -and $_.Extension -in ".exe", ".zip", ".sig", ".dmg", ".gz" } |
  Copy-Item -Destination $out -Force

$latestPath = Join-Path $out "latest.json"
$env:MARKDOWN233_BUNDLE_DIR = $out
$env:MARKDOWN233_MANIFEST_OUT = $latestPath
npm run release:manifest
if ($LASTEXITCODE -ne 0) { throw "manifest generation failed" }

Write-Host "Signed release build finished: $out"
