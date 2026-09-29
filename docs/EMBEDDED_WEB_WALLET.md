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

## The Android about:blank quirk

react-native-webview loads a string on Android with
`loadDataWithBaseURL(baseUrl, html, mime, encoding, null)`. The last argument
is the history URL, and passing `null` makes `WebView.getUrl()` report
`about:blank` even though the document's origin is the base URL. Every bridge
message therefore arrives with `nativeEvent.url === 'about:blank'` (plus the
fragment after a hash navigation). The origin check that guards bridge
authority dropped all of them, so on Android `SEED_STORED` never reached
native and "Set Transaction PIN" failed with "Native secure seed backup
failed". iOS is unaffected: `WKWebView.loadHTMLString(_:baseURL:)` sets
`webView.url` to the base URL.

`normalizeEmbeddedDocumentUrl` in `services/EmbeddedNavigationPolicy.ts` maps
`about:blank` and `about:blank#<fragment>` back onto the base URL, and
`QRLWebView` routes every consumer of `nativeEvent.url` through one helper so
the quirk cannot be handled in one caller and missed in another. It applies in
embedded mode only. In remote and dev mode a document at `about:blank` is not
the wallet, and accepting it would hand bridge authority to a blank page.

The rewrite is safe because in embedded mode the injected document is the only
document that can be at `about:blank` in that WebView: the navigation guard
refuses every other document load, the embedded CSP sets `frame-src` and
`child-src` to `'none'` so there are no subframes, and `onMessage` reports the
top-level document URL.

### Why not patch react-native-webview

The other fix is a patch-package change passing `baseUrl` as the history URL,
which would make `getUrl()` return `https://qrlwallet.com/` directly. It was
rejected. With a history URL set, `WebView.reload()` fetches that URL from the
network into the same origin, and `onShouldStartLoadWithRequest` is not
consulted for a programmatic reload, so the embedded document could be
silently replaced by whatever the server returns. That trades a
fail-closed bug for exactly the code-substitution risk this whole change
exists to remove. The patch would also apply to every WebView in the app and
would need re-verifying on each react-native-webview upgrade, while the
normaliser is app-side, scoped to embedded mode and unit-tested.

## Web source modes

`EXPO_PUBLIC_WEB_SOURCE` selects where the wallet comes from:

- `embedded` (the default in a release build): the bundled document.
- `remote`: `https://qrlwallet.com` live, the previous behaviour, kept as a
  fallback for a release that has to ship without a usable document.
- `dev`: the local frontend dev server at `EXPO_PUBLIC_DEV_URL`. This is the
  default when `__DEV__` is true.

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
