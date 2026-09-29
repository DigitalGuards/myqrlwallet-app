# Embedded web wallet

The app used to point its WebView at `https://qrlwallet.com` and let the server
decide what code ran. A compromise of that web server was therefore a wallet
compromise for every app user. The app now ships the whole web wallet inside
its own signed bundle.

## How it works

`assets/web/index.html` is the entire web wallet as one document: the app code,
its stylesheet, its fonts and its crypto worker all inlined. Nothing in it is
fetched from the network. It is produced by the frontend's `build:embedded`
target.

At runtime `components/QRLWebView.tsx` reads that document out of the bundle
and hands it to the WebView as a string with
`source={{ html, baseUrl: 'https://qrlwallet.com/' }}`. The document keeps the
qrlwallet.com origin, so localStorage, IndexedDB and the relay's CORS rules
behave exactly as they did before, while every executable byte comes from the
app binary.

`window.__QRL_EMBEDDED__` is set to `true` before the document's own scripts
run, which makes the wallet's router use hash routing. It is set twice:
`injectedJavaScriptBeforeContentLoaded` is the documented hook, but Android
delivers it from `onPageStarted` and can lose the race, so the flag is also
written into the document head before the string reaches the WebView.

## What the navigation guard allows

`services/EmbeddedNavigationPolicy.ts` is the whole policy:

| Navigation | Result |
|---|---|
| the injected document, once per load | allowed |
| `https://qrlwallet.com/#/...` fragments | allowed |
| a second load of `https://qrlwallet.com/` | blocked |
| any other qrlwallet.com path, an http downgrade, an alternate port | blocked, and never handed to the browser |
| any other http(s) origin | opened outside the app |
| any other scheme | blocked |

Because a reload would be a refused base-URL load, recovery is explicit: a dead
content process (`onContentProcessDidTerminate` on iOS,
`onRenderProcessGone` on Android) and the retry button both hand the document
to a fresh WebView instead of calling `reload()`.

## Android and the one-shot document allowance

Android loads the string with `loadDataWithBaseURL`. Loads a WebView starts on
its own do not go through `shouldOverrideUrlLoading`, so the navigation guard
is not necessarily called for the injected document and its one-shot base-URL
allowance could stay unspent, letting the first real navigation to
`https://qrlwallet.com/` through. The allowance is therefore spent when a
document starts loading, which both platforms report, as well as when the
guard admits one. On iOS the guard runs first, so that is a no-op there, and a
recovery reload resets it as before.

Measured on an Android 17 emulator with WebView 149, `nativeEvent.url` for the
embedded document is the base URL, so no URL rewriting is needed for the bridge
origin check. If a future WebView reports `about:blank` for a
`loadDataWithBaseURL` document, bridge messages would be dropped rather than
wrongly accepted, which is the safe direction to fail.

## The bundled wallet must be built for this network

The document comes from a separate frontend build. Without
`VITE_WALLET_PROFILE=v3-private` that build comes up on the old v2 network and
looks healthy until the first privileged bridge call: `SEED_STORED` carries
blockchain `TEST_NET` while `NativeBridge` requires `TEST_NET_V3`, the message
is refused as an invalid request, and the user sees "Native secure seed backup
failed" only after importing a seed and setting a PIN.

Two gates close that:

- `scripts/sync-embedded-web.sh` refuses to copy a document that does not carry
  the v3 markers, and records the verdict as `walletProfile` in
  `BUILD_INFO.json`.
- `services/EmbeddedWalletProfile.ts` re-checks the document at load time, and
  `QRLWebView` shows a native error naming the expected network instead of
  starting a wallet that will fail later.

The markers are the v3 chain id, the v3 genesis hash and the `qrlwallet:v3:`
storage prefix. The frontend compares the first two at runtime and builds the
third into every storage key, so a minifier cannot remove them, and a build
without the profile contains none of them. They answer "was this built for the
right network", which is a build accident. They are not a signature, and the
integrity of the document comes from it being inside the signed app binary.

A unit test pins the bash markers in the sync script to the TypeScript ones so
the two cannot drift.

## Binding the bridge to the shipped document

The origin check that guards bridge authority accepts any document on
https://qrlwallet.com, so it cannot tell the shipped wallet from another
document that reached that origin. In embedded mode the app therefore mints a
256-bit token per load, writes it into the document head, and the bootstrap
there wraps `ReactNativeWebView.postMessage` so every message this document
sends carries it. Native strips and checks the token before anything else and
drops a message that does not present it. A replacement document has no
wrapper and cannot produce one.

The token lives only in the HTML string. Injected scripts run in every
document the WebView loads, so putting it there would hand it to exactly the
documents it is meant to exclude. The document-end injected script names
`window.__qrlBindBridge`, a function the bootstrap left on the window, which
closes over the token: it re-binds the bridge if `ReactNativeWebView` only
appeared after the head script ran, and does nothing in a document that has no
such function.

A new document gets a new token, so a message held by an old one cannot be
replayed. If no message carries the token within 20 seconds of load, the app
says so rather than leaving a wallet on screen whose native features silently
do nothing.

## Storage inherited from the hosted wallet

An upgrading install keeps the qrlwallet.com origin, which is the point: the
accounts survive. It also keeps everything the served page ever wrote,
including service workers, which outlive the page that registered them and can
answer fetches. On the first embedded launch the app unregisters every service
worker, empties the Cache Storage API, drops the WebView HTTP cache and clears
dApp pairing sessions, which are short-lived by design. Encrypted seeds, PIN
material and the address book are left untouched: this pass is not allowed to
be the reason someone loses an account. A marker in SecureStore keeps it to
once per install.

Three parts are deliberately not done yet, because each needs the web wallet
to answer a question it has no message for: verifying the seeds the page holds
against the address and ciphertext hash native recorded at SEED_STORED time,
clearing qrlwallet.com cookies (react-native-webview exposes no API without
another native dependency), and flagging the address book for review.

## Supply chain

`assets/web/PIN.json` is the reviewed digest of the document: five lines a
reviewer actually reads, instead of a three megabyte blob nobody does.

- `scripts/verify-embedded-web.js` checks the committed document against it,
  and refuses a build recorded from a dirty frontend checkout or a profile
  other than v3. It runs as `npm run verify:embedded-web`, as the
  `eas-build-post-install` hook so a cloud build fails before it is signed,
  and in CI on every push.
- `scripts/reproduce-embedded-web.sh` goes further: it clones the frontend at
  the pinned commit, rebuilds and compares digests, so the pin is tied to
  public source rather than to a blob someone committed. CI runs it in its own
  job.
- `eas.json` sets `requireCommit`, so a cloud build cannot be made from an
  uncommitted tree.

The pin currently names a commit on the frontend pull-request branch, which a
squash merge will make unreachable. `ALLOW_UNREACHABLE_PIN` in the CI job
exists only for that window: once the frontend merges, re-sync from a tagged
commit on its default branch and drop the flag.

## Web source modes

`EXPO_PUBLIC_WEB_SOURCE` selects where the wallet comes from:

- `embedded` (the default in a release build): the bundled document.
- `remote`: `https://qrlwallet.com` live, the previous behaviour, kept as a
  fallback for a release that has to ship without a usable document. A release
  build also requires `EXPO_PUBLIC_ALLOW_REMOTE_WALLET` to be set to
  `the-server-can-replace-wallet-code`, so choosing it is a decision visible in
  a diff.
- `dev`: the local frontend dev server at `EXPO_PUBLIC_DEV_URL`. This is the
  default when `__DEV__` is true, and a release build refuses it: an
  `EXPO_PUBLIC_` value is baked in at build time, so a stray one would
  otherwise ship a wallet pointed at someone's laptop.

Every EAS profile that ships a binary pins `EXPO_PUBLIC_WEB_SOURCE=embedded`.

Settings shows which one is in use, and in embedded mode the frontend commit
the document was built from.

## Deep links

`qrlconnect://` pairing links are unchanged: `services/DAppDeepLink.ts`
normalizes them and `NativeBridge` forwards them as the same `DAPP_URI` bridge
message, with the same authorization, document-binding and lifetime rules.

Other `https://qrlwallet.com/...` universal links can no longer be loaded as
documents. `services/EmbeddedDeepLink.ts` maps a known wallet path onto the
matching hash route, `services/EmbeddedRouteIntent.ts` holds it, and the wallet
screen applies it inside the running document once the app is unlocked.
Unknown paths are dropped.

## Refreshing the bundled wallet

```bash
# builds ../myqrlwallet-frontend at its current checkout
scripts/sync-embedded-web.sh

# or a specific ref, from a specific checkout
FRONTEND_DIR=/path/to/myqrlwallet-frontend scripts/sync-embedded-web.sh main
```

The script refuses to copy a document that still references an external
script, a stylesheet or preload `<link>`, or an `/assets/` path, and it refuses
a build directory that holds anything beside `index.html`. It writes
`assets/web/index.html`, `assets/web/index.html.sha256` and
`assets/web/BUILD_INFO.json` (frontend commit, build time, sha256, size).
`services/__tests__/EmbeddedWalletDocument.test.ts` re-checks the hash and the
content rules on every test run.

The built document is committed for now, because EAS cloud builds need it in
the repository. The intended replacement is an EAS build hook that downloads a
pinned frontend release asset and verifies its sha256 against a checked-in
value, which keeps the repository small and makes the wallet version an
explicit, reviewable pin.

## Build variants

`app.config.js` reads `app.json` and layers a variant on top, selected with
`APP_VARIANT`:

- unset or `production`: `app.json` unchanged.
- `embedded-dev`: name `MyQRLWallet Embedded`, bundle id and Android package
  `com.chiefdg.myqrlwallet.embedded`, URL scheme `qrlconnect-embedded`, no
  associated domains and no `qrlwallet.com` intent filter. It can be installed
  next to the production app without competing for pairing links.

The EAS profile `development-embedded` builds that variant as an internal
development client.
