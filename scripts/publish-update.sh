#!/usr/bin/env bash
# Publish a signed over-the-air update. Run by the owner only.
#
#   scripts/publish-update.sh --channel <preview|production> --message <text> [--dry-run]
#
# Every publish needs the owner: the signing key is stored encrypted and gpg
# asks for its passphrase. See docs/OTA_UPDATES.md for the trust model.
set -euo pipefail

EAS_CLI_VERSION="24.11.0"
PLATFORMS="android ios"

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

# Pin the exact eas-cli version so nothing is fetched from npm while the key is on disk.
command -v eas > /dev/null || fail "eas-cli is not installed (npm install -g eas-cli@$EAS_CLI_VERSION)"
eas_version="$(eas --version | sed -n 's|^eas-cli/\([0-9][0-9.]*\).*|\1|p')"
[ "$eas_version" = "$EAS_CLI_VERSION" ] ||
  fail "eas-cli $EAS_CLI_VERSION is required (found '${eas_version:-unknown}')"

# An update only reaches apps whose runtime version matches. Refuse to publish
# to a channel unless a finished build on it runs the same runtime version, per
# platform, so a successful publish cannot reach nobody.
for platform in $PLATFORMS; do
  runtime="$(npx --no-install expo-updates runtimeversion:resolve --platform "$platform" |
    node -e 'let d="";process.stdin.on("data",(c)=>(d+=c)).on("end",()=>{const v=JSON.parse(d).runtimeVersion;if(!v)process.exit(1);console.log(v)})')" ||
    fail "could not resolve the $platform runtime version"
  builds="$(eas build:list --platform "$platform" --channel "$channel" --runtime-version "$runtime" \
    --status finished --limit 1 --json --non-interactive)" || fail "could not list $platform builds"
  [ "$(printf '%s' "$builds" | node -e 'let d="";process.stdin.on("data",(c)=>(d+=c)).on("end",()=>console.log(JSON.parse(d).length))')" -gt 0 ] ||
    fail "no finished $platform build on channel $channel has runtime version $runtime; an update would reach no installed app"
  echo "runtime ok: $platform $runtime"
done

keyfile="${UPDATE_SIGNING_KEY_GPG:-$HOME/.config/myqrlwallet-update-signing/private-key.pem.gpg}"
eas_args=(update --channel "$channel" --message "$message" --clear-cache --platform all --non-interactive)

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
  # Drop the cached key passphrase so a later decrypt prompts the owner again.
  gpg-connect-agent reloadagent /bye > /dev/null 2>&1 || true
}
trap cleanup EXIT
trap 'exit 130' INT TERM HUP
tmpkey="$(mktemp "$tmpdir/ota-signing-key.XXXXXX")"
out="$(mktemp "$tmpdir/ota-publish-out.XXXXXX")"

gpg --decrypt "$keyfile" > "$tmpkey"
[ -s "$tmpkey" ] || fail "decrypting the signing key failed"

eas "${eas_args[@]}" --json --private-key-path "$tmpkey" > "$out"
# The fingerprint runtime version differs per platform, so one update exists per platform.
PLATFORMS="$PLATFORMS" node -e '
  const r = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
  const list = Array.isArray(r) ? r : [r];
  if (list.length === 0) { console.error("error: eas reported no updates"); process.exit(1); }
  const seen = new Set();
  let bad = false;
  for (const u of list) {
    console.log(`published update: ${u.platform} runtime ${u.runtimeVersion} group ${u.group}`);
    if (seen.has(u.platform)) { console.error(`error: ${u.platform} appears twice`); bad = true; }
    seen.add(u.platform);
  }
  for (const p of process.env.PLATFORMS.split(" ")) {
    if (!seen.has(p)) { console.error(`error: no update reported for ${p}`); bad = true; }
  }
  process.exit(bad ? 1 : 0);
' "$out"
