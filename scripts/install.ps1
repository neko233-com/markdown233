param(
    [string]$InstallDir = "",
    [ValidateSet("2", "3")]
    [string]$TauriMajor = "2",
    [switch]$NoShortcut
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$BinaryName = "markdown233"
$ProductName = "Markdown233"

function Require-Command {
    param([string]$Name)
    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        throw "$Name not found. Install Node.js and Rust first."
    }
}

Require-Command "node"
Require-Command "npm"
Require-Command "cargo"

if ($TauriMajor -eq "3") {
    Write-Warning "Tauri 3 stable package not detected in current npm/cargo registry. Building with pinned Tauri 2.11.x and keeping 3-ready installer flag."
}

if (-not $InstallDir) {
    $InstallDir = Join-Path $env:LOCALAPPDATA $ProductName
}

Push-Location $Root
try {
    if (Test-Path "package-lock.json") {
        npm ci
        if ($LASTEXITCODE -ne 0) { throw "npm ci failed with exit code $LASTEXITCODE" }
    } else {
        npm install
        if ($LASTEXITCODE -ne 0) { throw "npm install failed with exit code $LASTEXITCODE" }
    }

    npx tauri build --bundles nsis
    if ($LASTEXITCODE -ne 0) { throw "tauri build failed with exit code $LASTEXITCODE" }

    $ReleaseExe = Join-Path $Root "src-tauri/target/release/$BinaryName.exe"
    if (-not (Test-Path $ReleaseExe)) {
        throw "Release binary not found: $ReleaseExe"
    }

    New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
    $Dest = Join-Path $InstallDir "$ProductName.exe"
    Copy-Item -LiteralPath $ReleaseExe -Destination $Dest -Force

    if (-not $NoShortcut) {
        $StartMenu = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs"
        $ShortcutPath = Join-Path $StartMenu "$ProductName.lnk"
        $Shell = New-Object -ComObject WScript.Shell
        $Shortcut = $Shell.CreateShortcut($ShortcutPath)
        $Shortcut.TargetPath = $Dest
        $Shortcut.WorkingDirectory = $InstallDir
        $Shortcut.Save()
    }

    Write-Host "Installed: $Dest"
    Write-Host "Run: $Dest"
}
finally {
    Pop-Location
}
