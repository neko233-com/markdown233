param(
    [string]$OutDir = ""
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$ProductName = "Markdown233"

if (-not $OutDir) {
    $OutDir = Join-Path $Root "release"
}

Push-Location $Root
try {
    if (-not $env:CARGO_BUILD_JOBS) {
        $env:CARGO_BUILD_JOBS = "1"
    }

    if (Test-Path "package-lock.json") {
        npm ci
        if ($LASTEXITCODE -ne 0) { throw "npm ci failed with exit code $LASTEXITCODE" }
    } else {
        npm install
        if ($LASTEXITCODE -ne 0) { throw "npm install failed with exit code $LASTEXITCODE" }
    }

    npx tauri build --bundles nsis --config src-tauri/tauri.no-updater-artifacts.conf.json
    if ($LASTEXITCODE -ne 0) { throw "tauri build failed with exit code $LASTEXITCODE" }

    $BundleDir = Join-Path $Root "src-tauri/target/release/bundle/nsis"
    $Setup = Get-ChildItem -LiteralPath $BundleDir -Filter "${ProductName}_*_x64-setup.exe" |
        Sort-Object LastWriteTime -Descending |
        Select-Object -First 1

    if (-not $Setup) {
        throw "NSIS setup not found in $BundleDir"
    }

    $Binary = Join-Path $Root "src-tauri/target/release/markdown233.exe"
    if (-not (Test-Path $Binary)) {
        throw "Release binary not found: $Binary"
    }

    New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
    Copy-Item -LiteralPath $Setup.FullName -Destination (Join-Path $OutDir $Setup.Name) -Force
    Copy-Item -LiteralPath $Binary -Destination (Join-Path $OutDir "markdown233.exe") -Force

    $ManifestPath = Join-Path $OutDir "release-windows.json"
    $Manifest = [ordered]@{
        product = $ProductName
        platform = "windows-x64"
        setup = $Setup.Name
        setupBytes = $Setup.Length
        binary = "markdown233.exe"
        binaryBytes = (Get-Item -LiteralPath $Binary).Length
        builtAt = (Get-Date).ToString("o")
    }
    $Manifest | ConvertTo-Json | Set-Content -LiteralPath $ManifestPath -Encoding UTF8

    Write-Host "Release ready: $OutDir"
    Write-Host "Setup: $($Setup.FullName)"
    Write-Host "Binary: $Binary"
}
finally {
    Pop-Location
}
