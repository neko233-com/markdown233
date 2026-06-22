#!/usr/bin/env sh
set -eu

OUT_DIR="${OUT_DIR:-release-check}"
UPDATER_URL="${UPDATER_URL:-https://github.com/neko233-com/markdown233/releases/latest/download/latest.json}"
ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"

require_env() {
  eval "value=\${$1:-}"
  if [ -z "$value" ]; then
    echo "Missing required environment variable: $1" >&2
    exit 1
  fi
}

if [ -z "${TAURI_SIGNING_PRIVATE_KEY:-}" ] && [ -z "${TAURI_SIGNING_PRIVATE_KEY_PATH:-}" ]; then
  echo "Missing required environment variable: TAURI_SIGNING_PRIVATE_KEY or TAURI_SIGNING_PRIVATE_KEY_PATH" >&2
  exit 1
fi
require_env TAURI_SIGNING_PRIVATE_KEY_PASSWORD

if [ -z "${TAURI_SIGNING_PRIVATE_KEY:-}" ] && [ -n "${TAURI_SIGNING_PRIVATE_KEY_PATH:-}" ]; then
  TAURI_SIGNING_PRIVATE_KEY="$(cat "$TAURI_SIGNING_PRIVATE_KEY_PATH")"
  export TAURI_SIGNING_PRIVATE_KEY
fi

if [ "$(uname -s)" = "Darwin" ]; then
  require_env APPLE_SIGNING_IDENTITY
  require_env APPLE_ID
  require_env APPLE_PASSWORD
  require_env APPLE_TEAM_ID
fi

cd "$ROOT_DIR"
mkdir -p "$OUT_DIR"
export CARGO_BUILD_JOBS="${CARGO_BUILD_JOBS:-1}"

npm ci
case "$(uname -s)" in
  Darwin*) npx tauri build --bundles app,dmg ;;
  MINGW*|MSYS*|CYGWIN*) npx tauri build --bundles nsis ;;
  *) echo "Unsupported OS for signed release." >&2; exit 1 ;;
esac

VERSION="$(node -p "require('./package.json').version")"
find "$ROOT_DIR/src-tauri/target/release/bundle" -type f \( -name "*$VERSION*.exe" -o -name "*$VERSION*.zip" -o -name "*$VERSION*.sig" -o -name "*$VERSION*.dmg" -o -name "*$VERSION*.gz" \) -exec cp {} "$OUT_DIR/" \;
MARKDOWN233_BUNDLE_DIR="$OUT_DIR" MARKDOWN233_MANIFEST_OUT="$OUT_DIR/latest.json" npm run release:manifest

echo "Signed release build finished: $OUT_DIR"
