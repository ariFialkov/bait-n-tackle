#!/usr/bin/env bash
#
# Bait N' Tackle build script.
#
# There is no bundler or compile step — the game is plain ES modules with
# Three.js vendored in. "Building" just assembles a clean, uploadable folder
# in ./dist containing only the files the game needs at runtime.
#
# The PWA manifest is emitted as manifest.json rather than
# manifest.webmanifest, because many static hosts reject the .webmanifest
# extension. Both filenames are equally valid to browsers.
#
# Usage:
#   ./build.sh                 -> dist/ with manifest.json
#   ./build.sh --no-manifest   -> dist/ with no manifest at all (no install
#                                 prompt / no home-screen install; the game
#                                 and its offline caching still work)
#   ./build.sh --zip           -> also writes bait-n-tackle.zip
#   ./build.sh --models-as data -> the .glb models renamed to .data (for a
#                                 host that refuses .glb; any extension works)
#
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
DIST="$ROOT/dist"

WANT_MANIFEST=1
WANT_ZIP=0
MODELS_AS=""
while [ $# -gt 0 ]; do
  case "$1" in
    --no-manifest) WANT_MANIFEST=0 ;;
    --zip) WANT_ZIP=1 ;;
    --models-as) shift; MODELS_AS="${1:-}"; [ -n "$MODELS_AS" ] || { echo "--models-as needs an extension (e.g. data)" >&2; exit 1; } ;;
    --models-as=*) MODELS_AS="${1#--models-as=}" ;;
    *) echo "Unknown option: $1" >&2; exit 1 ;;
  esac
  shift
done

echo "Building into $DIST"
rm -rf "$DIST"
mkdir -p "$DIST"

# Runtime files only — no node_modules, no git, no docs, no .nojekyll.
cp "$ROOT/index.html" "$ROOT/styles.css" "$ROOT/sw.js" "$DIST/"
cp -R "$ROOT/src" "$ROOT/vendor" "$ROOT/assets" "$DIST/"

if [ "$WANT_MANIFEST" -eq 1 ]; then
  cp "$ROOT/manifest.webmanifest" "$DIST/manifest.json"
  # perl -pi works identically on macOS (BSD) and Linux, unlike sed -i.
  perl -pi -e 's{manifest\.webmanifest}{manifest.json}g' "$DIST/index.html" "$DIST/sw.js"
  echo "  manifest: manifest.json"
else
  # Drop the <link rel="manifest"> tag and the service worker's cache entry.
  perl -ni -e 'print unless m{rel="manifest"}' "$DIST/index.html"
  perl -ni -e "print unless m{manifest\.webmanifest}" "$DIST/sw.js"
  echo "  manifest: omitted"
fi

# Some hosts accept only "web build" file types and refuse .glb. The models
# are the same bytes under whatever extension the host allows (the loader
# reads the bytes, not the name); the game is told the extension once.
if [ -n "$MODELS_AS" ]; then
  MODELS_AS="${MODELS_AS#.}"
  find "$DIST/assets" -type f -name '*.glb' | while read -r f; do mv "$f" "${f%.glb}.$MODELS_AS"; done
  perl -pi -e "s{MODEL_EXT = 'glb'}{MODEL_EXT = '$MODELS_AS'}" "$DIST/src/config.js"
  echo "  models: .$MODELS_AS"
  # Such a host may refuse .svg too: the icon falls back to its PNGs.
  rm -f "$DIST/assets/icon.svg"
  perl -pi -e 's{<link rel="icon" href="\./assets/icon\.svg" type="image/svg\+xml" />}{<link rel="icon" href="./assets/icon-192.png" type="image/png" />}' "$DIST/index.html"
  perl -ni -e 'print unless m{icon\.svg}' "$DIST/sw.js"
  if [ -f "$DIST/manifest.json" ]; then perl -0pi -e 's{,\s*\{[^{}]*icon\.svg[^{}]*\}}{}' "$DIST/manifest.json"; fi
  echo "  icon: png only"
fi

if [ "$WANT_ZIP" -eq 1 ]; then
  (cd "$DIST" && zip -qr "$ROOT/bait-n-tackle.zip" .)
  echo "  archive: $ROOT/bait-n-tackle.zip"
fi

echo "Done. $(find "$DIST" -type f | wc -l | tr -d ' ') files, $(du -sh "$DIST" | cut -f1) total."
echo "Upload the CONTENTS of $DIST (index.html must sit at the site root)."
