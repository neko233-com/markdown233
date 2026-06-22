param(
    [string]$InstallDir = "",
    [ValidateSet("2", "3")]
    [string]$TauriMajor = "2",
    [switch]$NoShortcut
)

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
& (Join-Path $ScriptDir "scripts/install.ps1") -InstallDir $InstallDir -TauriMajor $TauriMajor -NoShortcut:$NoShortcut
