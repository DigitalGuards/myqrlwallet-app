#!/usr/bin/env bash
#
# Build the web wallet as one self-contained HTML document and copy it into
# this app's bundle as assets/web/index.html.
#
# The app ships that document and hands it to the WebView as a string, so a
# compromise of the qrlwallet.com web server can no longer push wallet code to
# app users. That property only holds if the document is genuinely
# self-contained, so the output is checked here and the copy is refused when
# anything in it would be fetched from the network at runtime.
#
# Usage:
#   scripts/sync-embedded-web.sh [<git ref>]
#
# Environment:
#   FRONTEND_DIR   frontend checkout to build from (default: ../myqrlwallet-frontend)
#   SKIP_INSTALL   set to 1 to skip `npm ci` in the frontend checkout
#
# The git ref is optional. Given one, the frontend checkout is moved to it
# first; without one, whatever is checked out there is built. The resolved
# commit is recorded in assets/web/BUILD_INFO.json.

set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FRONTEND_DIR="${FRONTEND_DIR:-$APP_DIR/../myqrlwallet-frontend}"
REF="${1:-}"

OUT_DIR="$APP_DIR/assets/web"
OUT_HTML="$OUT_DIR/index.html"

fail() {
  echo "sync-embedded-web: $*" >&2
  exit 1
}

[ -d "$FRONTEND_DIR" ] || fail "frontend checkout not found at $FRONTEND_DIR (set FRONTEND_DIR)"
FRONTEND_DIR="$(cd "$FRONTEND_DIR" && pwd)"
[ -f "$FRONTEND_DIR/package.json" ] || fail "$FRONTEND_DIR has no package.json"

if ! node -e 'process.exit(require(process.argv[1]).scripts?.["build:embedded"] ? 0 : 1)' \
  "$FRONTEND_DIR/package.json"; then
  fail "the frontend at $FRONTEND_DIR has no build:embedded script"
fi

if [ -n "$REF" ]; then
  echo "sync-embedded-web: checking out $REF in the frontend"
  git -C "$FRONTEND_DIR" fetch --all --tags --quiet
  git -C "$FRONTEND_DIR" checkout --quiet "$REF"
fi

FRONTEND_COMMIT="$(git -C "$FRONTEND_DIR" rev-parse HEAD)"
FRONTEND_DIRTY=false
if [ -n "$(git -C "$FRONTEND_DIR" status --porcelain)" ]; then
  FRONTEND_DIRTY=true
  echo "sync-embedded-web: WARNING the frontend checkout has uncommitted changes" >&2
fi

if [ "${SKIP_INSTALL:-0}" != "1" ]; then
  echo "sync-embedded-web: installing frontend dependencies"
  (cd "$FRONTEND_DIR" && npm ci)
fi

echo "sync-embedded-web: building the embedded document from $FRONTEND_COMMIT"
(cd "$FRONTEND_DIR" && npm run build:embedded)

BUILT_HTML="$FRONTEND_DIR/dist-embedded/index.html"
[ -f "$BUILT_HTML" ] || fail "build:embedded produced no dist-embedded/index.html"

# The build directory must hold the document and nothing else except the
# checksum the frontend writes beside it. Anything more is something the build
# failed to inline and would be fetched from the network at runtime.
BUILT_SHA="$BUILT_HTML.sha256"
LEFTOVERS="$(find "$FRONTEND_DIR/dist-embedded" -mindepth 1 ! -path "$BUILT_HTML" ! -path "$BUILT_SHA" -print)"
[ -z "$LEFTOVERS" ] || fail "dist-embedded holds files beside index.html:"$'\n'"$LEFTOVERS"

# When the frontend published a checksum, the document has to match it before
# anything is copied into the app bundle.
if [ -f "$BUILT_SHA" ]; then
  (cd "$FRONTEND_DIR/dist-embedded" && sha256sum -c --quiet index.html.sha256) ||
    fail "dist-embedded/index.html does not match index.html.sha256"
fi

# Content checks. Each of these is a live request to the server at runtime.
reject_pattern() {
  local pattern="$1" description="$2"
  if grep -qiE "$pattern" "$BUILT_HTML"; then
    fail "the built document still references $description"
  fi
}

reject_pattern '<script[^>]+\bsrc[[:space:]]*=' 'an external script (<script src=)'
reject_pattern '<link[^>]+rel[[:space:]]*=[[:space:]]*"?(stylesheet|modulepreload|preload|manifest)' \
  'a stylesheet, preload or manifest <link>'
reject_pattern '<link[^>]+href[[:space:]]*=[[:space:]]*"[^"]+\.(js|css)"' 'a js or css <link>'
reject_pattern '(src|href)[[:space:]]*=[[:space:]]*"/assets/' 'a /assets/ path'
reject_pattern '"/assets/|'"'"'/assets/' 'a /assets/ path in script or style content'

BYTES="$(wc -c <"$BUILT_HTML" | tr -d ' ')"
SHA256="$(sha256sum "$BUILT_HTML" | cut -d' ' -f1)"

mkdir -p "$OUT_DIR"
cp "$BUILT_HTML" "$OUT_HTML"
printf '%s  index.html\n' "$SHA256" >"$OUT_DIR/index.html.sha256"

node - "$OUT_DIR/BUILD_INFO.json" "$FRONTEND_COMMIT" "$SHA256" "$BYTES" "$FRONTEND_DIRTY" <<'NODE'
const [, , outPath, commit, sha256, bytes, dirty] = process.argv;
const info = {
  frontendCommit: commit,
  frontendCommitShort: commit.slice(0, 12),
  frontendDirty: dirty === 'true',
  builtAt: new Date().toISOString(),
  sha256,
  bytes: Number(bytes),
};
require('node:fs').writeFileSync(outPath, JSON.stringify(info, null, 2) + '\n');
NODE

echo "sync-embedded-web: wrote $OUT_HTML"
echo "sync-embedded-web:   frontend  $FRONTEND_COMMIT"
echo "sync-embedded-web:   sha256    $SHA256"
echo "sync-embedded-web:   bytes     $BYTES"
