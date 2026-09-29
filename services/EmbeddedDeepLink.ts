/**
 * Translate a qrlwallet.com universal link into a route inside the embedded
 * document.
 *
 * With the wallet loaded from the app bundle, a path on qrlwallet.com can no
 * longer be opened as a document: the navigation guard refuses it, and opening
 * it in the system browser would defeat the point. The same link is still a
 * legitimate way to land on a wallet screen, so the path is mapped onto the
 * hash route the embedded build uses ("/transfer" becomes "#/transfer") and
 * applied inside the document that is already running.
 *
 * qrlconnect pairing links are deliberately out of scope here. They keep
 * flowing through DAppDeepLink and the unchanged DAPP_URI bridge message,
 * which carries the pairing secret and has its own readiness, authorization
 * and lifetime rules.
 */

const WALLET_HOST = 'qrlwallet.com';
const MAX_LINK_LENGTH = 4096;

/**
 * Routes the web wallet defines. An allowlist rather than a pass-through:
 * whatever arrives here comes from outside the app, and an unknown path would
 * land the user on the wallet's catch-all screen with attacker-chosen text in
 * the address bar of a page that holds keys.
 */
const WALLET_ROUTES: readonly string[] = [
  '/',
  '/create-account',
  '/import-account',
  '/add-account',
  '/account-list',
  '/create-token',
  '/qr-view',
  '/transfer',
  '/settings',
  '/terms',
  '/privacy',
  '/disclaimer',
  '/legal',
  '/security',
  '/token-status',
  '/tx-history',
  '/dapp-sessions',
  '/address-book',
  '/telegram',
];

/** /nft/<contract address>/<token id> */
const NFT_ROUTE_PATTERN = /^\/nft\/0x[0-9a-fA-F]{40}\/[0-9]{1,78}$/;

/** Paths owned by the dApp pairing flow, never turned into a route. */
const CONNECT_PATH = '/connect';

function parseWalletUrl(url: string): URL | null {
  if (typeof url !== 'string' || url.length === 0 || url.length > MAX_LINK_LENGTH) return null;
  if (url.trim() !== url) return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:') return null;
  if (parsed.hostname.toLowerCase() !== WALLET_HOST) return null;
  if (parsed.port !== '' && parsed.port !== '443') return null;
  if (parsed.username !== '' || parsed.password !== '') return null;
  return parsed;
}

/** True for any https://qrlwallet.com link, whatever the app does with it. */
export function isWalletUniversalLink(url: string): boolean {
  return parseWalletUrl(url) !== null;
}

/**
 * The hash route for a wallet universal link, or null when the link is not
 * one this app turns into a route (pairing links, unknown paths, anything off
 * qrlwallet.com).
 */
export function embeddedHashRouteForWalletUrl(url: string): string | null {
  const parsed = parseWalletUrl(url);
  if (!parsed) return null;

  const path = parsed.pathname;
  if (path === CONNECT_PATH) return null;

  // A trailing slash on a named route is the same screen.
  const normalized = path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path;

  if (WALLET_ROUTES.includes(normalized)) return `#${normalized}`;
  if (NFT_ROUTE_PATTERN.test(normalized)) return `#${normalized}`;
  return null;
}
