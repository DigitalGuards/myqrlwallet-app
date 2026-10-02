import Constants from 'expo-constants';

import Logger from './Logger';

const MAX_DAPP_LINK_LENGTH = 4096;

/**
 * The pairing scheme the embedded-dev variant registers.
 *
 * That variant deliberately takes its own scheme so it cannot compete with an
 * installed production app for `qrlconnect://`. The cost is that the whole
 * deep-link pairing path could not be exercised before release: the URI
 * arrived with a scheme nothing downstream accepts and was dropped in
 * silence. It is normalised to the production scheme here, at the single
 * entry point, so the rest of the path is the one that ships.
 */
const EMBEDDED_DEV_SCHEME = 'qrlconnect-embedded:';
const PRODUCTION_SCHEME = 'qrlconnect:';

/** The URL schemes this build registered, as Expo reports them. */
export function configuredSchemes(): readonly string[] {
  const scheme = Constants.expoConfig?.scheme;
  if (typeof scheme === 'string') return [scheme];
  return Array.isArray(scheme) ? scheme.filter((value) => typeof value === 'string') : [];
}

/**
 * Rewrite an embedded-dev pairing URI onto the production scheme.
 *
 * Only a build that actually registered the variant scheme does this, so a
 * production build cannot be handed a URI in a scheme it does not own.
 */
export function normalizeVariantScheme(
  url: string,
  schemes: readonly string[] = configuredSchemes(),
): string {
  if (typeof url !== 'string') return '';
  if (!schemes.includes('qrlconnect-embedded')) return url;
  if (!url.toLowerCase().startsWith(EMBEDDED_DEV_SCHEME)) return url;
  return PRODUCTION_SCHEME + url.slice(EMBEDDED_DEV_SCHEME.length);
}

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
export function isQrlConnectSystemUrl(rawUrl: string): boolean {
  const url = normalizeVariantScheme(rawUrl);
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
export function normalizeQrlConnectDeepLink(rawUrl: string): string | null {
  const url = normalizeVariantScheme(rawUrl);
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
