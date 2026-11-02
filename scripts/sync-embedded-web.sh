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
#   EXPO_PUBLIC_QRL_NETWORK_PROFILE
#                  network the app build is for: testnet (default) or mainnet.
#                  Use the value the EAS build profile sets.
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

# The network this app build is for, from services/NativeNetworkProfiles.json.
# Resolved before anything is built, so a network without a pinned chain id and
# genesis hash (the mainnet until it launches) stops the sync here.
PROFILE_HELPER="$APP_DIR/scripts/native-network-profile.js"
WALLET_PROFILE="$(node "$PROFILE_HELPER" profile)" ||
  fail "no usable network profile for this build (see the message above)"
echo "sync-embedded-web: network profile $WALLET_PROFILE"

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
# An exact tag on the built commit, when there is one. The reproduce job
# prefers it, because a tag survives a squash merge and a person can read it.
FRONTEND_TAG="$(git -C "$FRONTEND_DIR" describe --tags --exact-match 2>/dev/null || echo '')"
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

# Network profile. A document built for another network, or without the v3
# profile at all, looks fine until the first privileged bridge call fails, so
# it is refused here. The markers are the chain id, genesis hash and storage
# prefix of the selected network in services/NativeNetworkProfiles.json. The
# frontend compares the first two at runtime, so a minifier cannot remove them.
# services/EmbeddedWalletProfile.ts applies the same markers when the app
# loads the document.
node "$PROFILE_HELPER" check "$BUILT_HTML" >/dev/null ||
  fail "the built document was not built for the $WALLET_PROFILE network. Build the frontend with VITE_WALLET_PROFILE=v3-private and its VITE_V3_* settings (a mainnet app also needs VITE_V3_NATIVE_NETWORK=mainnet and the VITE_MAINNET_* pins)."

BYTES="$(wc -c <"$BUILT_HTML" | tr -d ' ')"
SHA256="$(sha256sum "$BUILT_HTML" | cut -d' ' -f1)"

mkdir -p "$OUT_DIR"
cp "$BUILT_HTML" "$OUT_HTML"
printf '%s  index.html\n' "$SHA256" >"$OUT_DIR/index.html.sha256"

node - "$OUT_DIR/BUILD_INFO.json" "$FRONTEND_COMMIT" "$SHA256" "$BYTES" "$FRONTEND_DIRTY" "$WALLET_PROFILE" <<'NODE'
const [, , outPath, commit, sha256, bytes, dirty, walletProfile] = process.argv;
const info = {
  frontendCommit: commit,
  frontendCommitShort: commit.slice(0, 12),
  frontendDirty: dirty === 'true',
  walletProfile,
  builtAt: new Date().toISOString(),
  sha256,
  bytes: Number(bytes),
};
require('node:fs').writeFileSync(outPath, JSON.stringify(info, null, 2) + '\n');
NODE

# PIN.json is the reviewed artifact. A reviewer checks these five lines rather
# than a three megabyte blob, and the build and CI re-verify the document
# against them.
node - "$OUT_DIR/PIN.json" "$FRONTEND_COMMIT" "$SHA256" "$BYTES" "$WALLET_PROFILE" "$FRONTEND_TAG" <<'NODE'
const [, , outPath, commit, sha256, bytes, walletProfile, frontendTag] = process.argv;
const fs = require('node:fs');
let existing = {};
try {
  existing = JSON.parse(fs.readFileSync(outPath, 'utf8'));
} catch {
  existing = {};
}
const pin = {
  comment:
    'Reviewed pin for the wallet document shipped in assets/web/index.html. A build verifies the file against this before it is packaged, so changing the wallet requires changing this file in a reviewed commit.',
  frontendCommit: commit,
  frontendTag,
  frontendRef: existing.frontendRef ?? '',
  walletProfile,
  sha256,
  bytes: Number(bytes),
};
fs.writeFileSync(outPath, JSON.stringify(pin, null, 2) + '\n');
NODE

echo "sync-embedded-web: wrote $OUT_HTML"
echo "sync-embedded-web:   frontend  $FRONTEND_COMMIT"
echo "sync-embedded-web:   sha256    $SHA256"
echo "sync-embedded-web:   bytes     $BYTES"
echo "sync-embedded-web:   profile   $WALLET_PROFILE"
