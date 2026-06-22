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

require_env TAURI_SIGNING_PRIVATE_KEY
require_env TAURI_SIGNING_PRIVATE_KEY_PASSWORD

if [ "$(uname -s)" = "Darwin" ]; then
  require_env APPLE_SIGNING_IDENTITY
  require_env APPLE_ID
  require_env APPLE_PASSWORD
  require_env APPLE_TEAM_ID
fi

cd "$ROOT_DIR"
mkdir -p "$OUT_DIR"

npm ci
npx tauri build

VERSION="$(node -p "require('./package.json').version")"
cat > "$OUT_DIR/latest.json" <<JSON
{
  "version": "$VERSION",
  "notes": "Markdown233 $VERSION",
  "pub_date": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "platforms": {},
  "updater_url": "$UPDATER_URL"
}
JSON

echo "Signed release build finished. Fill platform URLs/signatures in $OUT_DIR/latest.json after upload."
