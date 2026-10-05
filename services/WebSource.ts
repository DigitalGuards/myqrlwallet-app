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
 * without a usable embedded document, and a release build will only use it
 * when a second, explicit flag says so, because selecting it gives the web
 * server the power the embedded build exists to remove.
 *
 * `dev` points the WebView at a local frontend dev server. A release build
 * refuses it outright: an EXPO_PUBLIC_ variable is baked in at build time, so
 * a stray value in a build profile would otherwise ship a wallet pointed at
 * someone's laptop.
 */
export type WebSourceMode = 'embedded' | 'remote' | 'dev';

export const WEB_SOURCE_MODES: readonly WebSourceMode[] = ['embedded', 'remote', 'dev'];

/**
 * The second flag a release build needs before it will load the wallet from
 * the network. The value is deliberately a sentence: it has to be written
 * into a build profile on purpose, and it reads as a decision in a diff.
 */
export const REMOTE_WALLET_ACKNOWLEDGEMENT = 'the-server-can-replace-wallet-code';

export interface WebSourceEnvironment {
  /** EXPO_PUBLIC_WEB_SOURCE */
  requested: string | undefined;
  /** __DEV__ */
  isDevelopment: boolean;
  /** EXPO_PUBLIC_ALLOW_REMOTE_WALLET */
  remoteAcknowledgement?: string | undefined;
}

export interface WebSourceResolution {
  mode: WebSourceMode;
  /** Set when the requested mode was refused, for logging and for Settings. */
  refused?: { requested: string; reason: 'release-build' | 'needs-acknowledgement' | 'unknown' };
}

function normalize(value: string | undefined): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

/**
 * Resolve the configured mode and say when a request was refused.
 *
 * An explicit EXPO_PUBLIC_WEB_SOURCE wins in a development run so the dev
 * server workflow is unchanged. In a release build the only modes reachable
 * are `embedded` and, with the acknowledgement flag, `remote`. Anything else
 * falls back to `embedded` instead of throwing: a typo in a build profile must
 * not brick the app, and the refusal is visible in Settings and in the log.
 */
export function resolveWebSource(environment: WebSourceEnvironment): WebSourceResolution {
  const requested = normalize(environment.requested);
  const isKnown = (WEB_SOURCE_MODES as readonly string[]).includes(requested);

  if (environment.isDevelopment) {
    if (isKnown) return { mode: requested as WebSourceMode };
    return requested === ''
      ? { mode: 'dev' }
      : { mode: 'dev', refused: { requested, reason: 'unknown' } };
  }

  if (requested === 'dev') {
    return { mode: 'embedded', refused: { requested, reason: 'release-build' } };
  }
  if (requested === 'remote') {
    return normalize(environment.remoteAcknowledgement) === REMOTE_WALLET_ACKNOWLEDGEMENT
      ? { mode: 'remote' }
      : { mode: 'embedded', refused: { requested, reason: 'needs-acknowledgement' } };
  }
  if (requested === '' || requested === 'embedded') return { mode: 'embedded' };
  return { mode: 'embedded', refused: { requested, reason: 'unknown' } };
}

/** The resolved mode on its own, for call sites that do not report refusals. */
export function resolveWebSourceMode(
  rawValue: string | undefined,
  isDevelopment: boolean,
  remoteAcknowledgement?: string,
): WebSourceMode {
  return resolveWebSource({ requested: rawValue, isDevelopment, remoteAcknowledgement }).mode;
}

/** True when the mode serves the document from the app bundle. */
export function isEmbeddedMode(mode: WebSourceMode): boolean {
  return mode === 'embedded';
}
