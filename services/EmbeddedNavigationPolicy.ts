/**
 * Navigation policy for the embedded wallet document.
 *
 * The WebView is handed one HTML string under the https://qrlwallet.com/ base
 * URL. Everything the wallet does must stay inside that document: a real
 * navigation to https://qrlwallet.com/ would replace the shipped bytes with
 * whatever the live server returns, which is the exact dependency the embedded
 * build removes. So the guard admits only the injected document itself, once
 * per load and only on the platform that actually asks, and same-document
 * fragment navigations within it.
 *
 * A same-origin URL that is neither of those is refused outright and is not
 * handed to the system browser either: bouncing the user to the live site is
 * the same trust problem one step removed. Links to other origins are opened
 * outside the app, where they cannot touch wallet storage.
 */
export const EMBEDDED_BASE_URL = 'https://qrlwallet.com/';

/** The only prefix a same-document fragment navigation can have. */
const FRAGMENT_PREFIX = `${EMBEDDED_BASE_URL}#`;

export type EmbeddedNavigationDecision =
  | { action: 'allow'; reason: 'initial-document' | 'fragment' | 'webview-internal' }
  | { action: 'open-external' }
  | {
      action: 'block';
      reason:
        | 'repeat-document'
        | 'same-origin-path'
        | 'unsupported-scheme'
        | 'navigation-type'
        | 'subframe';
    };

/**
 * A navigation request as react-native-webview reports it.
 *
 * `navigationType` and `isTopFrame` are iOS only. Android reports neither, and
 * the Android branch of the policy does not need them: it never admits a
 * document load through the guard at all.
 */
export interface EmbeddedNavigationRequest {
  url: string;
  navigationType?: string;
  isTopFrame?: boolean;
  mainDocumentURL?: string;
}

export interface EmbeddedNavigationState {
  /** False once the injected document has been admitted for the current load. */
  initialDocumentPending: boolean;
  /** 'ios' | 'android' | anything else react-native reports. */
  platform: string;
  /** Defaults to the production base URL; injected for tests. */
  baseUrl?: string;
}

const MAX_NAVIGATION_URL_LENGTH = 8192;

/**
 * Navigation types that must never reach the shipped document.
 *
 * `reload` is the important one. WebKit reloads a `loadHTMLString` page by
 * fetching the base URL, so a `location.reload()` or `history.go(0)` from
 * inside the wallet would silently pull the live page over the embedded one.
 * `backforward` can walk the history entry for the base URL the same way, and
 * a form submission is not something the shipped wallet does.
 */
const REFUSED_NAVIGATION_TYPES = new Set([
  'reload',
  'backforward',
  'formsubmit',
  'formresubmit',
]);

function isWalletHost(candidate: URL, base: URL): boolean {
  // A trailing dot is the same host to DNS and to the WebView, and a
  // different string to a naive comparison.
  const strip = (host: string) => host.toLowerCase().replace(/\.$/, '');
  return strip(candidate.hostname) === strip(base.hostname);
}

export function classifyEmbeddedNavigation(
  request: EmbeddedNavigationRequest,
  state: EmbeddedNavigationState,
): EmbeddedNavigationDecision {
  const url = request?.url;
  if (typeof url !== 'string' || url.length === 0 || url.length > MAX_NAVIGATION_URL_LENGTH) {
    return { action: 'block', reason: 'unsupported-scheme' };
  }

  // about:blank and about:srcdoc are the WebView's own empty states, emitted
  // around a string load on both platforms.
  if (url === 'about:blank' || url === 'about:srcdoc') {
    return { action: 'allow', reason: 'webview-internal' };
  }

  // A subframe cannot exist under the embedded CSP (frame-src and child-src
  // are 'none'), so a request that reports itself as one is already wrong.
  if (request.isTopFrame === false) {
    return { action: 'block', reason: 'subframe' };
  }

  const baseUrl = state.baseUrl ?? EMBEDDED_BASE_URL;
  const fragmentPrefix = baseUrl === EMBEDDED_BASE_URL ? FRAGMENT_PREFIX : `${baseUrl}#`;

  // Matched on the raw string, not on a parsed URL. `https://qrlwallet.com/?#/x`
  // parses with an empty-looking search and a hash, but it is a real network
  // navigation that would fetch the live page.
  //
  // Checked ahead of the navigation types because the refusals below are
  // about the base URL. A `backforward` within the fragment is the wallet
  // walking its own hash history, which is the whole point of hash routing;
  // refusing it would break the first in-app back arrow on iOS. A `reload`
  // stays refused even on a fragment, because WebKit reloads a
  // loadHTMLString page by refetching the base URL.
  if (url.startsWith(fragmentPrefix) && request.navigationType !== 'reload') {
    return { action: 'allow', reason: 'fragment' };
  }

  if (typeof request.navigationType === 'string' &&
      REFUSED_NAVIGATION_TYPES.has(request.navigationType)) {
    return { action: 'block', reason: 'navigation-type' };
  }

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

  const isBaseDocument =
    target.pathname === base.pathname && target.search === '' && target.hash === '';
  if (isBaseDocument) {
    // Android loads the document with loadDataWithBaseURL, which a WebView
    // does not route through shouldOverrideUrlLoading. Any base-URL request
    // that does reach the guard there is therefore a navigation the page
    // asked for, never the shipped document arriving.
    if (state.platform === 'android') {
      return { action: 'block', reason: 'repeat-document' };
    }
    // iOS reports the injected document as a top-frame navigation of type
    // 'other'. Anything else claiming the base URL is a real load.
    const navigationType = request.navigationType;
    if (navigationType !== undefined && navigationType !== 'other') {
      return { action: 'block', reason: 'navigation-type' };
    }
    if (state.initialDocumentPending) {
      return { action: 'allow', reason: 'initial-document' };
    }
    return { action: 'block', reason: 'repeat-document' };
  }

  // Any other qrlwallet.com document: refuse it and keep the user inside the
  // shipped wallet.
  return { action: 'block', reason: 'same-origin-path' };
}
