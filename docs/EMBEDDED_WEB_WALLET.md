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
| the injected document, once per load, top frame, type `other`, iOS only | allowed |
| a raw URL starting exactly `https://qrlwallet.com/#` | allowed |
| a base URL request on Android | blocked, always |
| navigation type `reload`, `backforward`, `formsubmit`, `formresubmit` | blocked |
| anything reporting itself as a subframe | blocked |
| any other qrlwallet.com URL, an http downgrade, an alternate port, a trailing dot | blocked, and never handed to the browser |
| any other http(s) origin | handed to the external-link policy |
| any other scheme | blocked |

The fragment rule matches the raw string on purpose. `https://qrlwallet.com/?#/x`
parses with a hash and an empty-looking query, and it is a real network
navigation that would fetch the live page.

Android loads the string with `loadDataWithBaseURL`, which a WebView does not
route through `shouldOverrideUrlLoading`, so the guard never sees the shipped
document arriving there. The one-shot base-URL allowance is therefore spent
when a document starts loading as well as when the guard admits one, and on
Android the guard never grants it at all.

Because a reload would be a refused base-URL load, recovery is explicit: a dead
content process (`onContentProcessDidTerminate` on iOS,
`onRenderProcessGone` on Android) and the retry button both hand the document
to a fresh WebView instead of calling `reload()`.

`originWhitelist` is `['*']` in embedded mode, deliberately.
react-native-webview checks that list first and hands anything outside it
straight to `Linking.openURL`, which would open `tel:`, `intent:` and the app's
own `qrlconnect:` pairing scheme. Widening it is what makes this policy the
only gate. Everything that then leaves the app goes through
`services/ExternalLinkPolicy.ts`, which allows https, `mailto:` and `tel:`, and
never the wallet's own hosts. The embedded wallet also intercepts external
links and sends them over the bridge as `OPEN_URL`, so that handler is the
second half of the same boundary: it keeps its existing scheme rules (https,
plus http on loopback for development) and also refuses the wallet's hosts.

## Android needs a request interceptor, not just a navigation guard

A WebView never consults `shouldOverrideUrlLoading` for its own `reload()`.
Measured on an Android 17 emulator with WebView 149: a `location.reload()`
inside the embedded document made the WebView fetch https://qrlwallet.com/ and
run the live production bundle in that origin, inside the app. The per-load
token kept it off the bridge, but it had the origin's localStorage and could
have imitated the wallet's own PIN prompt. The shipped document contains no
`reload()` call, so nothing walked down that path, and a path that is
fail-open only because nothing walks down it is still fail-open.

`patches/react-native-webview+13.15.0.patch` closes it in the WebView client,
where every request is visible:

- the manager records the document string and base URL it was handed, so the
  client has the shipped bytes,
- `shouldInterceptRequest` answers a main-frame GET of the base URL with those
  bytes, which makes `reload()` re-serve the shipped document,
- it leaves `/api/` and `/relay` on the wallet origin to the network: the RPC
  proxy, the history, token, NFT and IPFS services, and the dApp relay's
  socket.io polling transport,
- and it answers everything else on that origin with an empty 403, so the
  network cannot deliver a document or a script for the wallet origin.

Other origins are untouched. `services/EmbeddedRequestPolicy.ts` states the
same rules in TypeScript and is unit tested, and a test pins the Java
allowlist against it so the two cannot drift.

The same patch makes the existing Android navigation check fail closed.
Upstream lets a navigation proceed when the JavaScript policy does not answer
within 250 ms or the wait is interrupted; the patch blocks in both cases.

A second layer sits in JavaScript: a second document start inside one load is
treated as foreign and the shipped string is re-served with a fresh token,
bounded so a WebView that reported two starts per load could not loop.

That layer needs to know what a document start actually is, and upstream does
not say. Android emits its only loading-start event from
`doUpdateVisitedHistory`, which fires for same-document history updates too,
leaving JS to guess from a `loading` progress flag. React Router calls
`history.replaceState` during module init, while the page is still loading, so
that event arrives with `loading: true` and looked exactly like a page swap:
on device the app landed on its "replaced by another page" screen on every
cold start. The patch therefore tags the events at the source. `onPageStarted`
carries `newDocument: true` and is the one callback that means a document is
being replaced; `doUpdateVisitedHistory` carries `newDocument: false`. The
result no longer depends on the order of the two callbacks or on a progress
value, and an unpatched build still falls back to the old heuristic.

The shipped document inlines everything, so any request that reaches the
refusal branch is one the WebView made on its own, `/favicon.ico` being the
usual one. The refusal logs the path, without its query, so the next device
run names it.

On iOS `decidePolicyForNavigationAction` does see reloads, and navigation type
`reload` is refused by the guard. That still wants a device check once an iOS
build exists.

Measured on the same emulator, `nativeEvent.url` for the embedded document is
the base URL, so no URL rewriting is needed for the bridge origin check. If a
future WebView reported `about:blank` for a `loadDataWithBaseURL` document,
bridge messages would be dropped rather than wrongly accepted, which is the
safe direction to fail.

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

The bootstrap is inserted at the very top of the head, above the document's
Content-Security-Policy meta. A meta policy governs only what follows it, so a
script above it runs outside that policy. That is deliberate: this script is
the app's own code, shipped in the app binary, and keeping it out of the
policy is what lets the document declare a policy with hashes instead of
`'unsafe-inline'`. A per-load token cannot be hashed at build time, so while
the script sits under the policy the document is forced to keep
`'unsafe-inline'` and every other inline script in the page gets the same
permission. The frontend can therefore move to
`script-src 'sha256-<app script>' 'wasm-unsafe-eval'`.

The bootstrap removes its own tag once it has run, so the token is not left in
the DOM for an error reporter, a copy of `innerHTML` or a screenshot tool to
pick up. It stays reachable only through the closure.

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
answer fetches.

The pass has two halves, because they have different timing requirements.

The caches half runs natively after load: unregister every service worker,
empty the Cache Storage API, drop the WebView HTTP cache. None of that is
state the wallet's stores read at boot, so running it late is safe.

The sessions half runs inside the document, before its stores initialise. dApp
sessions are restored and reconnected during store initialisation, so clearing
them from outside would race: a restored pairing writes itself back at its
next checkpoint and survives. The bootstrap therefore sets
`window.__QRL_EMBEDDED_MIGRATION__` next to the embedded flag, and the page
clears its own pairing keys before anything reads them. The native marker is
written only when the page acknowledges over the bridge with
`EMBEDDED_MIGRATION_DONE`, so a launch where the page never acknowledged
retries instead of silently considering itself migrated. The acknowledgement
carries the document token like any other message and never reaches
NativeBridge.

Encrypted seeds, PIN material and the address book are left untouched: this
pass is not allowed to be the reason someone loses an account.

Three parts are deliberately not done yet, because each needs the web wallet
to answer a question it has no message for: verifying the seeds the page holds
against the address and ciphertext hash native recorded at SEED_STORED time,
clearing qrlwallet.com cookies (react-native-webview exposes no cookie API,
and adding one is a native dependency this change does not need), and flagging
the address book for review.

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

The pin names either `frontendTag` or a bare `frontendCommit`. A tag is the
intended end state: it survives a squash merge and it is a name a person can
check, and the reproduce script verifies the tag resolves to the commit the
pin records.

Today the pin names a commit on the frontend pull-request branch, which a
squash merge will make unreachable, and `ALLOW_UNREACHABLE_PIN` in the CI job
exists only for that window. The plan, in order: frontend PR 327 merges to
`dev`, `dev` is promoted to `main`, `embedded-v1.0.0` is tagged on frontend
`main`, this repo re-syncs and re-pins from that tag, `ALLOW_UNREACHABLE_PIN`
is deleted, and `reproduce-embedded-wallet` becomes a required check. No store
build goes out before that sequence is finished.

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
