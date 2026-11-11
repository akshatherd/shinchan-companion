#!/usr/bin/env sh
set -eu
ROOT="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
MODEL="${SHINCHAN_MODEL:-$ROOT/shinchan.glb}"
[ -f "$MODEL" ] || { echo "Model not found: $MODEL" >&2; exit 1; }
cp "$MODEL" "$ROOT/overlay-web/public/models/shinchan.glb"
cd "$ROOT/overlay-web"
if [ ! -f node_modules/vite/bin/vite.js ]; then npm ci; fi
if ! npm run build; then
  echo "Vite could not start; trying the bundled Rollup fallback." >&2
  npm run build:offline
fi
test -s "$ROOT/overlay-web/dist/models/shinchan.glb" || { echo "Built overlay is missing models/shinchan.glb" >&2; exit 1; }
test -f "$ROOT/overlay-web/dist/animations/manifest.json" || { echo "Built overlay is missing animations/manifest.json" >&2; exit 1; }
DEST="$ROOT/android-app/app/src/main/assets/overlay"
mkdir -p "$DEST"
cp -R dist/. "$DEST/"
test -s "$DEST/models/shinchan.glb" || { echo "Android assets are missing models/shinchan.glb" >&2; exit 1; }
test -f "$DEST/animations/manifest.json" || { echo "Android assets are missing animations/manifest.json" >&2; exit 1; }
echo "Overlay built and synced to Android assets."
