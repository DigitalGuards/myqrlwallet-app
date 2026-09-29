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
  // around a string load on both platforms.
  if (url === 'about:blank' || url === 'about:srcdoc') {
    return { action: 'allow', reason: 'webview-internal' };
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
