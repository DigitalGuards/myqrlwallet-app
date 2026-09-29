#!/usr/bin/env bash
#
# Rebuild the pinned wallet document from the frontend and compare digests.
#
# scripts/verify-embedded-web.js proves the committed blob still matches the
# reviewed pin. This goes one step further and proves the pin corresponds to
# public frontend source: it clones the frontend at the commit recorded in
# assets/web/PIN.json, runs its embedded build and compares the sha256.
#
# It is the slow gate, so it runs on its own in CI and on demand locally.
#
# Environment:
#   FRONTEND_REPO   default https://github.com/DigitalGuards/myqrlwallet-frontend.git
#   ALLOW_UNREACHABLE_PIN=1
#                   exit 0 with a notice when the pinned ref cannot be fetched.
#                   Needed only while the pin points at a pull-request branch,
#                   because a squash merge makes that commit unreachable.
#                   Delete it, and make this job a required check, as soon as
#                   the pin names a tag on the frontend default branch.
#
# The pin names either a tag (`frontendTag`) or a bare commit
# (`frontendCommit`). A tag is the intended end state: it survives a squash
# merge and it is a name a person can check, so the fetch prefers it.

set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FRONTEND_REPO="${FRONTEND_REPO:-https://github.com/DigitalGuards/myqrlwallet-frontend.git}"

PIN_SHA="$(node -p "require('$APP_DIR/assets/web/PIN.json').sha256")"
PIN_COMMIT="$(node -p "require('$APP_DIR/assets/web/PIN.json').frontendCommit")"
PIN_TAG="$(node -p "require('$APP_DIR/assets/web/PIN.json').frontendTag || ''")"

if [ -n "$PIN_TAG" ]; then
  FETCH_REF="refs/tags/$PIN_TAG"
  echo "reproduce-embedded-web: pinned frontend tag $PIN_TAG ($PIN_COMMIT)"
else
  FETCH_REF="$PIN_COMMIT"
  echo "reproduce-embedded-web: pinned frontend $PIN_COMMIT"
fi
echo "reproduce-embedded-web: pinned sha256   $PIN_SHA"

WORK="$(mktemp -d)"
cleanup() { rm -rf "$WORK"; }
trap cleanup EXIT

git init --quiet "$WORK"
git -C "$WORK" remote add origin "$FRONTEND_REPO"
if ! git -C "$WORK" fetch --quiet --depth 1 origin "$FETCH_REF" 2>/dev/null; then
  if [ "${ALLOW_UNREACHABLE_PIN:-0}" = "1" ]; then
    echo "reproduce-embedded-web: SKIPPED, $FETCH_REF is not reachable in $FRONTEND_REPO."
    echo "reproduce-embedded-web: re-pin to a tagged commit on the frontend default branch."
    exit 0
  fi
  echo "reproduce-embedded-web: $FETCH_REF is not reachable in $FRONTEND_REPO" >&2
  exit 1
fi
git -C "$WORK" checkout --quiet FETCH_HEAD

# A tag has to name the commit the pin records, or the tag was moved.
FETCHED_COMMIT="$(git -C "$WORK" rev-parse HEAD)"
if [ "$FETCHED_COMMIT" != "$PIN_COMMIT" ]; then
  echo "reproduce-embedded-web: $FETCH_REF is $FETCHED_COMMIT, the pin records $PIN_COMMIT" >&2
  exit 1
fi

(cd "$WORK" && npm ci --no-audit --no-fund)
(cd "$WORK" && npm run build:embedded)

BUILT="$WORK/dist-embedded/index.html"
[ -f "$BUILT" ] || { echo "reproduce-embedded-web: the frontend produced no document" >&2; exit 1; }

BUILT_SHA="$(sha256sum "$BUILT" | cut -d' ' -f1)"
echo "reproduce-embedded-web: rebuilt sha256  $BUILT_SHA"

if [ "$BUILT_SHA" != "$PIN_SHA" ]; then
  echo "reproduce-embedded-web: the rebuilt document does not match the pin" >&2
  exit 1
fi

COMMITTED_SHA="$(sha256sum "$APP_DIR/assets/web/index.html" | cut -d' ' -f1)"
if [ "$COMMITTED_SHA" != "$PIN_SHA" ]; then
  echo "reproduce-embedded-web: the committed document does not match the pin" >&2
  exit 1
fi

echo "reproduce-embedded-web: ok, the shipped wallet reproduces from $PIN_COMMIT"
