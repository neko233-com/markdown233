#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BINARY_NAME="markdown233"
PRODUCT_NAME="Markdown233"
TAURI_MAJOR="${TAURI_MAJOR:-2}"
INSTALL_DIR="${MARKDOWN233_INSTALL_DIR:-}"

while [ "$#" -gt 0 ]; do
    case "$1" in
        --tauri-major)
            TAURI_MAJOR="${2:-2}"
            shift 2
            ;;
        --install-dir)
            INSTALL_DIR="${2:-}"
            shift 2
            ;;
        *)
            echo "unknown arg: $1"
            exit 1
            ;;
    esac
done

need() {
    command -v "$1" >/dev/null 2>&1 || {
        echo "$1 not found. Install Node.js and Rust first."
        exit 1
    }
}

need node
need npm
need cargo

if [ "$TAURI_MAJOR" = "3" ]; then
    echo "warning: Tauri 3 stable package not detected in current npm/cargo registry; building pinned Tauri 2.11.x."
fi

if [ -z "$INSTALL_DIR" ]; then
    case "$(uname -s)" in
        Darwin*) INSTALL_DIR="$HOME/Applications/$PRODUCT_NAME" ;;
        MINGW*|MSYS*|CYGWIN*) INSTALL_DIR="$LOCALAPPDATA/$PRODUCT_NAME" ;;
        *)
            echo "unsupported os: only Windows and macOS are supported"
            exit 1
            ;;
    esac
fi

cd "$ROOT"
export CARGO_BUILD_JOBS="${CARGO_BUILD_JOBS:-1}"
if [ -f package-lock.json ]; then
    npm ci
else
    npm install
fi

case "$(uname -s)" in
    Darwin*) npx tauri build --bundles app,dmg --no-sign --config src-tauri/tauri.no-updater-artifacts.conf.json ;;
    MINGW*|MSYS*|CYGWIN*) npx tauri build --bundles nsis --config src-tauri/tauri.no-updater-artifacts.conf.json ;;
    *)
        echo "unsupported os: only Windows and macOS are supported"
        exit 1
        ;;
esac

EXT=""
case "$(uname -s)" in
    MINGW*|MSYS*|CYGWIN*) EXT=".exe" ;;
esac

RELEASE_BIN="$ROOT/src-tauri/target/release/${BINARY_NAME}${EXT}"
if [ ! -f "$RELEASE_BIN" ]; then
    echo "release binary not found: $RELEASE_BIN"
    exit 1
fi

mkdir -p "$INSTALL_DIR"
TARGET="$INSTALL_DIR/${BINARY_NAME}${EXT}"
cp "$RELEASE_BIN" "$TARGET"
chmod +x "$TARGET" || true

echo "Installed: $TARGET"
echo "Run: $TARGET"
