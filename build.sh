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
#
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
DIST="$ROOT/dist"

WANT_MANIFEST=1
WANT_ZIP=0
for arg in "$@"; do
  case "$arg" in
    --no-manifest) WANT_MANIFEST=0 ;;
    --zip) WANT_ZIP=1 ;;
    *) echo "Unknown option: $arg" >&2; exit 1 ;;
  esac
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

if [ "$WANT_ZIP" -eq 1 ]; then
  (cd "$DIST" && zip -qr "$ROOT/bait-n-tackle.zip" .)
  echo "  archive: $ROOT/bait-n-tackle.zip"
fi

echo "Done. $(find "$DIST" -type f | wc -l | tr -d ' ') files, $(du -sh "$DIST" | cut -f1) total."
echo "Upload the CONTENTS of $DIST (index.html must sit at the site root)."
