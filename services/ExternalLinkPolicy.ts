/**
 * The one place a URL leaves the app for the operating system.
 *
 * react-native-webview runs its own `originWhitelist` check before the
 * component's policy and hands anything outside that list straight to
 * `Linking.openURL` (WebViewShared `createOnShouldStartLoadWithRequest`). That
 * path would open `tel:`, `intent:`, `qrlconnect:` and every other scheme a
 * page can name, including the app's own pairing scheme, which would let the
 * wallet document drive the app's deep-link handling from inside a web page.
 *
 * Everything that leaves the app is therefore funnelled through
 * `externalOpenDecision` and checked against an allowlist. The default is
 * https only. `mailto:` and `tel:` are allowed because they are inert handoffs
 * to the mail and dialer apps and the wallet's legal pages use them.
 */
const ALLOWED_EXTERNAL_SCHEMES = new Set(['https:', 'mailto:', 'tel:']);

/** Hosts the app owns. Opening them externally would show the live wallet. */
const WALLET_HOSTS = new Set(['qrlwallet.com', 'www.qrlwallet.com']);

const MAX_EXTERNAL_URL_LENGTH = 8192;

export type ExternalOpenDecision =
  | { action: 'open'; url: string }
  | { action: 'refuse'; reason: 'length' | 'unparsable' | 'scheme' | 'credentials' | 'wallet-host' };

function normalizeHost(host: string): string {
  return host.toLowerCase().replace(/\.$/, '');
}

/**
 * True when the URL names a host this app serves the wallet from. Opening one
 * outside the app would show the live site, which is the dependency the
 * embedded build removes.
 */
export function isWalletOwnHost(url: string): boolean {
  try {
    return WALLET_HOSTS.has(normalizeHost(new URL(url).hostname));
  } catch {
    return false;
  }
}

export function externalOpenDecision(url: string): ExternalOpenDecision {
  if (typeof url !== 'string' || url.length === 0 || url.length > MAX_EXTERNAL_URL_LENGTH) {
    return { action: 'refuse', reason: 'length' };
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { action: 'refuse', reason: 'unparsable' };
  }

  if (!ALLOWED_EXTERNAL_SCHEMES.has(parsed.protocol)) {
    return { action: 'refuse', reason: 'scheme' };
  }

  // Userinfo is refused whatever the scheme. It is an origin-confusion trick
  // and never legitimate in a link the wallet hands to the OS.
  if (parsed.username || parsed.password) {
    return { action: 'refuse', reason: 'credentials' };
  }

  if (parsed.protocol === 'https:') {
    // A trailing dot resolves to the same host, so it has to be stripped
    // before the comparison or it would slip past as a foreign origin.
    if (WALLET_HOSTS.has(normalizeHost(parsed.hostname))) {
      return { action: 'refuse', reason: 'wallet-host' };
    }
  }

  // The normalized form, never the caller's string. WHATWG and Android's Uri
  // parser disagree about inputs such as `https://evil.example\@wallet/`:
  // WHATWG reads the host as evil.example, Android reads the authority after
  // the last '@'. Handing on what this policy actually judged removes the
  // disagreement.
  return { action: 'open', url: parsed.href };
}
