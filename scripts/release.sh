#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="${MARKDOWN233_RELEASE_DIR:-$ROOT/release}"
PRODUCT_NAME="Markdown233"
OS="$(uname -s)"

case "$OS" in
    Darwin*) ;;
    MINGW*|MSYS*|CYGWIN*) ;;
    *)
        echo "unsupported os: only Windows and macOS are supported"
        exit 1
        ;;
esac

cd "$ROOT"
if [ -f package-lock.json ]; then
    npm ci
else
    npm install
fi

mkdir -p "$OUT_DIR"
if [ "$OS" = "Darwin" ]; then
    npx tauri build --bundles app,dmg
    cp -R "$ROOT/src-tauri/target/release/bundle/macos/${PRODUCT_NAME}.app" "$OUT_DIR/" 2>/dev/null || true
    cp "$ROOT/src-tauri/target/release/bundle/dmg/"*.dmg "$OUT_DIR/"
    echo "Release ready: $OUT_DIR"
else
    npx tauri build --bundles nsis
    cp "$ROOT/src-tauri/target/release/markdown233.exe" "$OUT_DIR/"
    cp "$ROOT/src-tauri/target/release/bundle/nsis/"*.exe "$OUT_DIR/"
    echo "Release ready: $OUT_DIR"
fi
