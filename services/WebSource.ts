/**
 * Where the wallet web application comes from.
 *
 * `embedded` ships the whole wallet as one HTML document inside the signed
 * app bundle and hands it to the WebView as a string under the
 * https://qrlwallet.com/ base URL. The document keeps the qrlwallet.com
 * origin, so localStorage, IndexedDB and relay CORS behave exactly as before,
 * while every executable byte comes from the app binary. A compromise of the
 * qrlwallet.com web server can then no longer push wallet code to app users.
 *
 * `remote` is the previous behaviour: the WebView loads https://qrlwallet.com
 * live. It stays available as a fallback for a release that has to ship
 * without a usable embedded document.
 *
 * `dev` points the WebView at a local frontend dev server, as before.
 */
export type WebSourceMode = 'embedded' | 'remote' | 'dev';

export const WEB_SOURCE_MODES: readonly WebSourceMode[] = ['embedded', 'remote', 'dev'];

/**
 * Resolve the configured mode.
 *
 * An explicit EXPO_PUBLIC_WEB_SOURCE always wins so a build profile can pin
 * the mode. With nothing set, a production binary is embedded and a local
 * development run keeps talking to the dev server, which is what the previous
 * `__DEV__ ? DEV_URL : 'https://qrlwallet.com'` default did.
 *
 * An unrecognised value falls back to the same default instead of throwing:
 * a typo in a build profile must not brick the app, and the mismatch is
 * visible in the About section of Settings.
 */
export function resolveWebSourceMode(rawValue: string | undefined, isDevelopment: boolean): WebSourceMode {
  const normalized = typeof rawValue === 'string' ? rawValue.trim().toLowerCase() : '';
  if ((WEB_SOURCE_MODES as readonly string[]).includes(normalized)) {
    return normalized as WebSourceMode;
  }
  return isDevelopment ? 'dev' : 'embedded';
}

/** True when the mode serves the document from the app bundle. */
export function isEmbeddedMode(mode: WebSourceMode): boolean {
  return mode === 'embedded';
}
