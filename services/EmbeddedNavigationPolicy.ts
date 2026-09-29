/**
 * Navigation policy for the embedded wallet document.
 *
 * The WebView is handed one HTML string under the https://qrlwallet.com/ base
 * URL. Everything the wallet does must stay inside that document: a real
 * navigation to https://qrlwallet.com/ would replace the shipped bytes with
 * whatever the live server returns, which is the exact dependency the embedded
 * build removes. So the guard admits only the injected document itself, once
 * per load, and fragment navigations within it.
 *
 * A same-origin URL that is neither of those is refused outright and is not
 * handed to the system browser either: bouncing the user to the live site is
 * the same trust problem one step removed. Links to other origins are opened
 * outside the app, where they cannot touch wallet storage.
 */
export const EMBEDDED_BASE_URL = 'https://qrlwallet.com/';

export type EmbeddedNavigationDecision =
  | { action: 'allow'; reason: 'initial-document' | 'fragment' | 'webview-internal' }
  | { action: 'open-external' }
  | { action: 'block'; reason: 'repeat-document' | 'same-origin-path' | 'unsupported-scheme' };

export interface EmbeddedNavigationState {
  /** False once the injected document has been admitted for the current load. */
  initialDocumentPending: boolean;
  /** Defaults to the production base URL; injected for tests. */
  baseUrl?: string;
}

const MAX_NAVIGATION_URL_LENGTH = 8192;

const ABOUT_BLANK = 'about:blank';

/**
 * The document URL an embedded WebView reports, mapped back onto the base URL
 * the document actually runs on.
 *
 * Android's react-native-webview loads a string with
 * `loadDataWithBaseURL(baseUrl, html, mime, encoding, null)`. The last
 * argument is the history URL, and passing null makes `WebView.getUrl()`
 * report `about:blank` even though the document's origin is the base URL.
 * Every message from the wallet therefore arrives with
 * `nativeEvent.url === 'about:blank'` (plus the fragment after a hash
 * navigation), and an origin check on that raw value drops every bridge
 * message. On Android that silently broke SEED_STORED and everything else.
 *
 * Rewriting it is safe because in embedded mode the injected document is the
 * only document that can be at about:blank in this WebView:
 *   - classifyEmbeddedNavigation refuses every other document load, including
 *     a second load of the base URL;
 *   - the embedded CSP sets frame-src and child-src to 'none', so the
 *     document has no subframes that could post from another origin;
 *   - onMessage reports the top-level document URL.
 *
 * iOS needs none of this: WKWebView's `loadHTMLString(_:baseURL:)` sets
 * `webView.url` to the base URL, so the value arrives already correct and
 * this function returns it unchanged.
 *
 * Callers must apply this ONLY in embedded mode. In remote and dev mode a
 * document at about:blank is not the wallet, and accepting it would hand
 * bridge authority to a blank page.
 */
export function normalizeEmbeddedDocumentUrl(
  url: string,
  baseUrl: string = EMBEDDED_BASE_URL,
): string {
  if (typeof url !== 'string' || url.length > MAX_NAVIGATION_URL_LENGTH) return '';
  if (url === ABOUT_BLANK) return baseUrl;
  if (url.startsWith(`${ABOUT_BLANK}#`)) return baseUrl + url.slice(ABOUT_BLANK.length);
  return url;
}

function isWalletHost(candidate: URL, base: URL): boolean {
  return candidate.hostname.toLowerCase() === base.hostname.toLowerCase();
}

export function classifyEmbeddedNavigation(
  url: string,
  state: EmbeddedNavigationState,
): EmbeddedNavigationDecision {
  if (typeof url !== 'string' || url.length === 0 || url.length > MAX_NAVIGATION_URL_LENGTH) {
    return { action: 'block', reason: 'unsupported-scheme' };
  }

  // about:blank and about:srcdoc are the WebView's own empty states, emitted
  // around a string load on both platforms. On Android the injected document
  // itself reports about:blank, so a hash navigation inside it surfaces as
  // about:blank#/route.
  if (url === ABOUT_BLANK || url === 'about:srcdoc') {
    return { action: 'allow', reason: 'webview-internal' };
  }
  if (url.startsWith(`${ABOUT_BLANK}#`)) {
    return { action: 'allow', reason: 'fragment' };
  }

  const baseUrl = state.baseUrl ?? EMBEDDED_BASE_URL;
  let base: URL;
  let target: URL;
  try {
    base = new URL(baseUrl);
    target = new URL(url);
  } catch {
    return { action: 'block', reason: 'unsupported-scheme' };
  }

  if (target.protocol !== 'http:' && target.protocol !== 'https:') {
    return { action: 'block', reason: 'unsupported-scheme' };
  }

  // Credentials in the URL are an origin-confusion trick and never legitimate.
  if (target.username || target.password) {
    return { action: 'block', reason: 'unsupported-scheme' };
  }

  if (!isWalletHost(target, base)) {
    return { action: 'open-external' };
  }

  // The wallet host itself never goes to the system browser: sending the user
  // to the live site is the same trust problem one step removed. An http
  // downgrade or an alternate port is refused outright.
  if (target.protocol !== base.protocol || target.port !== base.port) {
    return { action: 'block', reason: 'same-origin-path' };
  }

  const isBasePath = target.pathname === base.pathname && target.search === '';
  if (isBasePath && target.hash !== '') {
    return { action: 'allow', reason: 'fragment' };
  }
  if (isBasePath) {
    if (state.initialDocumentPending) {
      return { action: 'allow', reason: 'initial-document' };
    }
    return { action: 'block', reason: 'repeat-document' };
  }

  // Any other qrlwallet.com document: refuse it and keep the user inside the
  // shipped wallet.
  return { action: 'block', reason: 'same-origin-path' };
}
