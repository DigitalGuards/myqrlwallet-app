#!/usr/bin/env bash
# Publish a signed over-the-air update. Run by the owner only.
#
#   scripts/publish-update.sh --channel <preview|production> --message <text> [--dry-run]
#
# Every publish needs the owner: the signing key is stored encrypted and gpg
# asks for its passphrase. See docs/OTA_UPDATES.md for the trust model.
set -euo pipefail

usage() {
  echo "usage: $0 --channel <preview|production> --message <text> [--dry-run]" >&2
  exit 2
}

channel=""
message=""
dry_run=0
while [ $# -gt 0 ]; do
  case "$1" in
    --channel) [ $# -ge 2 ] || usage; channel="$2"; shift 2 ;;
    --message) [ $# -ge 2 ] || usage; message="$2"; shift 2 ;;
    --dry-run) dry_run=1; shift ;;
    *) usage ;;
  esac
done

case "$channel" in
  preview | production) ;;
  *) echo "error: --channel must be preview or production" >&2; usage ;;
esac
[ -n "$message" ] || { echo "error: --message is required" >&2; usage; }

fail() { echo "error: $*" >&2; exit 1; }

root="$(git rev-parse --show-toplevel)" || fail "not inside a git repository"
cd "$root"

# Refuse unpublished or uncommitted state, so the update matches a commit others can read.
[ -z "$(git status --porcelain)" ] || fail "working tree is not clean"
branch="$(git rev-parse --abbrev-ref HEAD)"
if [ "$channel" = "production" ]; then
  case "$branch" in
    main | dev) ;;
    *) fail "production updates publish from main or dev only (on $branch)" ;;
  esac
fi
git fetch --quiet origin || fail "could not fetch origin"
[ -n "$(git branch -r --contains HEAD)" ] || fail "HEAD is not pushed to origin"

# The bundle is built from node_modules, so install exactly what the lockfile pins.
echo "install: npm ci"
npm ci --silent

# Gates stop the publish on any failure (set -e).
for gate in lint typecheck test:ci verify:embedded-web; do
  echo "gate: npm run $gate"
  npm run --silent "$gate"
done

# The update bundle uses the environment the production EAS build uses for the
# JS bundle (eas.json build.production.env, JS-visible values only). APP_VARIANT
# stays unset so the production identifiers apply.
#
# No EAS environment is passed: eas-cli would merge that environment's server
# side variables over these and could shape the bundle that gets signed. The
# environment prompt of eas-cli for SDK 55 and newer is skipped explicitly, and
# dotenv files are ignored so only the committed tree and these exports count.
export EXPO_PUBLIC_WEB_SOURCE=embedded
export EAS_UPDATE_SKIP_ENVIRONMENT_CHECK=1
export EXPO_NO_DOTENV=1
unset APP_VARIANT

# Pin the eas-cli major version so nothing is fetched from npm while the key is on disk.
command -v eas > /dev/null || fail "eas-cli is not installed (npm install -g eas-cli@21)"
eas_version="$(eas --version | sed -n 's|^eas-cli/\([0-9]*\)\..*|\1|p')"
[ "$eas_version" = "21" ] || fail "eas-cli 21.x is required (found major '${eas_version:-unknown}')"

keyfile="${UPDATE_SIGNING_KEY_GPG:-$HOME/.config/myqrlwallet-update-signing/private-key.pem.gpg}"
eas_args=(update --channel "$channel" --message "$message" --clear-cache --non-interactive)

if [ "$dry_run" -eq 1 ]; then
  echo "dry run: checks passed, nothing decrypted or published"
  printf 'would run: eas'
  printf ' %q' "${eas_args[@]}" --json --private-key-path '<temporary key file>'
  printf '\n'
  exit 0
fi

[ -f "$keyfile" ] || fail "encrypted signing key not found at $keyfile"

tmpdir=/dev/shm
[ -d "$tmpdir" ] && [ -w "$tmpdir" ] || tmpdir="${TMPDIR:-/tmp}"
umask 077
tmpkey=""
out=""
cleanup() {
  [ -z "$tmpkey" ] || shred -u "$tmpkey" 2> /dev/null || rm -f "$tmpkey"
  [ -z "$out" ] || rm -f "$out"
}
trap cleanup EXIT
trap 'exit 130' INT TERM HUP
tmpkey="$(mktemp "$tmpdir/ota-signing-key.XXXXXX")"
out="$(mktemp "$tmpdir/ota-publish-out.XXXXXX")"

gpg --decrypt "$keyfile" > "$tmpkey"
[ -s "$tmpkey" ] || fail "decrypting the signing key failed"

eas "${eas_args[@]}" --json --private-key-path "$tmpkey" > "$out"
groups="$(node -e '
  const r = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
  const list = Array.isArray(r) ? r : [r];
  const groups = [...new Set(list.map((u) => u.group).filter(Boolean))];
  if (groups.length === 0) process.exit(1);
  console.log(groups.join(" "));
' "$out")" || fail "update published but the group id could not be read from the eas output"
# The fingerprint runtime version differs per platform, so a publish for all
# platforms yields one group per platform.
for group in $groups; do
  echo "published update group: $group"
done
