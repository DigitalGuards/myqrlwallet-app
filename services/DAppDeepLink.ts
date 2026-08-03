import Logger from './Logger';

const MAX_DAPP_LINK_LENGTH = 4096;

function isVerifiedConnectUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (
      parsed.protocol === 'https:' &&
      parsed.hostname.toLowerCase() === 'qrlwallet.com' &&
      (parsed.port === '' || parsed.port === '443') &&
      parsed.username === '' &&
      parsed.password === '' &&
      parsed.pathname === '/connect' &&
      parsed.search.length > 1 &&
      parsed.hash === ''
    );
  } catch {
    return false;
  }
}

/** Identify URLs that must bypass Expo Router's route parser. */
export function isQrlConnectSystemUrl(url: string): boolean {
  if (
    typeof url !== 'string' ||
    url.length === 0 ||
    url.length > MAX_DAPP_LINK_LENGTH ||
    url.trim() !== url
  ) {
    return false;
  }
  return url.startsWith('qrlconnect:') || isVerifiedConnectUrl(url);
}

/**
 * Recognize a QRL Connect deep link without ever passing its bearer payload
 * to a logger. The URI itself is forwarded only to the wallet WebView.
 */
export function normalizeQrlConnectDeepLink(url: string): string | null {
  if (!isQrlConnectSystemUrl(url)) return null;

  if (url.startsWith('qrlconnect:')) {
    Logger.debug('RootLayout', 'qrlconnect deep link received (URI redacted)');
    return url;
  }

  const parsed = new URL(url);
  Logger.debug('RootLayout', 'qrlconnect deep link received (URI redacted)');
  return `qrlconnect://?${parsed.search.slice(1)}`;
}

export function acceptQrlConnectDeepLink(url: string): boolean {
  return normalizeQrlConnectDeepLink(url) !== null;
}
