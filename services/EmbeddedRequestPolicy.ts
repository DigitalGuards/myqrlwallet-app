/**
 * What the Android WebView is allowed to fetch from the wallet origin.
 *
 * The navigation guard cannot cover everything on Android. A WebView does not
 * consult `shouldOverrideUrlLoading` for its own `reload()`, so a
 * `location.reload()` inside the embedded document made the WebView fetch
 * https://qrlwallet.com/ from the network and run the live production bundle
 * in that origin, inside the app, with the origin's localStorage. The per-load
 * token kept it off the bridge, but it could still read storage and imitate
 * the wallet's own UI. Verified on an Android 17 emulator, WebView 149.
 *
 * `shouldInterceptRequest` is the layer that does see every request, including
 * a reload, so that is where this policy is enforced. It answers a main-frame
 * request for the base URL with the bundled document, which makes `reload()`
 * re-serve the shipped bytes instead of fetching them, and refuses every
 * other executable or document request to the wallet origin. Only the paths
 * the wallet genuinely calls are left to the network.
 *
 * This module is the readable, tested statement of the rules. The Java side
 * of `patches/react-native-webview+13.15.0.patch` implements the same three
 * decisions; a test pins the allowlist in both so they cannot drift.
 */
export type EmbeddedRequestDecision =
  /** Answer with the document the app shipped, without touching the network. */
  | { action: 'serve-bundled-document' }
  /** Answer with an empty 403. Nothing on this origin may deliver code. */
  | { action: 'refuse' }
  /** Let the network handle it: another origin, or a wallet API path. */
  | { action: 'allow';
      reason: 'other-origin' | 'wallet-api' };

export interface EmbeddedRequestContext {
  url: string;
  method: string;
  isForMainFrame: boolean;
  /** Defaults to the production base URL; injected for tests. */
  baseUrl?: string;
}

/**
 * Path prefixes the wallet calls on its own origin.
 *
 * `/api/` is the RPC proxy, the transaction history, token and NFT services
 * and the IPFS proxy. `/relay` is the dApp connect relay: socket.io is
 * configured with that path, and its polling transport is an ordinary HTTP
 * request that this interceptor would otherwise refuse. WebSocket upgrades do
 * not pass through `shouldInterceptRequest` at all.
 *
 * Nothing here can deliver a document or a script the WebView will execute:
 * they are JSON and socket.io frames.
 */
export const WALLET_ORIGIN_ALLOWED_PREFIXES: readonly string[] = ['/api/', '/relay'];

function isAllowedWalletPath(pathname: string): boolean {
  if (pathname === '/api') return true;
  return WALLET_ORIGIN_ALLOWED_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

export function classifyEmbeddedRequest(
  context: EmbeddedRequestContext,
): EmbeddedRequestDecision {
  const baseUrl = context.baseUrl ?? 'https://qrlwallet.com/';
  let base: URL;
  let target: URL;
  try {
    base = new URL(baseUrl);
    target = new URL(context.url);
  } catch {
    // Not a URL this policy understands. Nothing to serve and nothing to
    // vouch for, so refuse rather than hand it to the network.
    return { action: 'refuse' };
  }

  const strip = (host: string) => host.toLowerCase().replace(/\.$/, '');
  if (strip(target.hostname) !== strip(base.hostname)) {
    return { action: 'allow', reason: 'other-origin' };
  }

  // An http downgrade or an alternate port on the wallet host is never the
  // wallet, whatever it asks for.
  if (target.protocol !== base.protocol || target.port !== base.port) {
    return { action: 'refuse' };
  }

  const isBaseDocument = target.pathname === base.pathname;
  if (context.isForMainFrame && context.method.toUpperCase() === 'GET' && isBaseDocument) {
    return { action: 'serve-bundled-document' };
  }

  if (isAllowedWalletPath(target.pathname)) {
    return { action: 'allow', reason: 'wallet-api' };
  }

  return { action: 'refuse' };
}
