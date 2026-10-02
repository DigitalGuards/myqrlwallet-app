import Logger from '../Logger';
import {
  acceptQrlConnectDeepLink,
  configuredSchemes,
  isQrlConnectSystemUrl,
  normalizeQrlConnectDeepLink,
  normalizeVariantScheme,
} from '../DAppDeepLink';

jest.mock('../Logger', () => ({
  __esModule: true,
  default: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

describe('QRL Connect deep-link logging', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('accepts the URI without logging its bearer capability', () => {
    const uri =
      'qrlconnect://?q=PQP3-BEARER-CAPABILITY&r=https%3A%2F%2Frelay.example';

    expect(acceptQrlConnectDeepLink(uri)).toBe(true);

    expect(Logger.debug).toHaveBeenCalledWith(
      'RootLayout',
      'qrlconnect deep link received (URI redacted)',
    );
    expect(JSON.stringify((Logger.debug as jest.Mock).mock.calls)).not.toContain(
      uri,
    );
    expect(JSON.stringify((Logger.debug as jest.Mock).mock.calls)).not.toContain(
      'PQP3-BEARER-CAPABILITY',
    );
  });

  it('does not log unrelated schemes', () => {
    expect(acceptQrlConnectDeepLink('https://example.com')).toBe(false);
    expect(Logger.debug).not.toHaveBeenCalled();
  });

  it('rejects an oversized bearer URI before forwarding or logging', () => {
    const uri = `qrlconnect://?q=${'A'.repeat(4097)}`;

    expect(acceptQrlConnectDeepLink(uri)).toBe(false);
    expect(Logger.debug).not.toHaveBeenCalled();
  });

  it('rejects a mixed-case custom scheme instead of widening the canonical URI grammar', () => {
    expect(isQrlConnectSystemUrl('QrLcOnNeCt://?q=ABC%25DEF')).toBe(false);
    expect(normalizeQrlConnectDeepLink('QrLcOnNeCt://?q=ABC%25DEF')).toBeNull();
    expect(Logger.debug).not.toHaveBeenCalled();
  });

  it('normalizes the exact verified HTTPS connect route', () => {
    expect(
      normalizeQrlConnectDeepLink(
        'https://qrlwallet.com/connect?q=ABC%25DEF&r=https%3A%2F%2Frelay.example',
      ),
    ).toBe('qrlconnect://?q=ABC%25DEF&r=https%3A%2F%2Frelay.example');
  });

  it.each([
    'http://qrlwallet.com/connect?q=ABC',
    'https://qrlwallet.com.evil/connect?q=ABC',
    'https://user@qrlwallet.com/connect?q=ABC',
    'https://qrlwallet.com:444/connect?q=ABC',
    'https://qrlwallet.com/connect/extra?q=ABC',
  ])('rejects an unverified HTTPS lookalike %s', (url) => {
    expect(normalizeQrlConnectDeepLink(url)).toBeNull();
  });
});

describe('embedded-dev pairing scheme', () => {
  const variant = ['qrlconnect-embedded'];
  const production = ['qrlconnect'];

  it('rewrites its own scheme onto the production one', () => {
    // The variant registers qrlconnect-embedded so it cannot compete with an
    // installed production app for qrlconnect://. Without this rewrite the
    // whole deep-link pairing path could not be exercised before release.
    expect(normalizeVariantScheme('qrlconnect-embedded://?q=PAYLOAD', variant)).toBe(
      'qrlconnect://?q=PAYLOAD',
    );
    expect(normalizeVariantScheme('QRLCONNECT-EMBEDDED://?q=PAYLOAD', variant)).toBe(
      'qrlconnect://?q=PAYLOAD',
    );
    // And the resulting URI is one the rest of the path already accepts.
    expect(normalizeQrlConnectDeepLink(normalizeVariantScheme('qrlconnect-embedded://?q=P', variant)))
      .toBe('qrlconnect://?q=P');
  });

  it('leaves everything else exactly as it is', () => {
    expect(normalizeVariantScheme('qrlconnect://?q=PAYLOAD', variant)).toBe(
      'qrlconnect://?q=PAYLOAD',
    );
    expect(normalizeVariantScheme('qrlconnect-embedded-evil://?q=X', variant)).toBe(
      'qrlconnect-embedded-evil://?q=X',
    );
    expect(normalizeVariantScheme('https://qrlwallet.com/connect?q=P', variant)).toBe(
      'https://qrlwallet.com/connect?q=P',
    );
    // Only the scheme changes; the payload is untouched.
    expect(normalizeVariantScheme('qrlconnect-embedded://?q=A%25B&r=wss://x', variant)).toBe(
      'qrlconnect://?q=A%25B&r=wss://x',
    );
  });

  it('does nothing in a build that did not register the variant scheme', () => {
    expect(normalizeVariantScheme('qrlconnect-embedded://?q=PAYLOAD', production)).toBe(
      'qrlconnect-embedded://?q=PAYLOAD',
    );
    expect(normalizeVariantScheme('qrlconnect-embedded://?q=PAYLOAD', [])).toBe(
      'qrlconnect-embedded://?q=PAYLOAD',
    );
    // So the entry points still refuse it there.
    expect(isQrlConnectSystemUrl('qrlconnect-embedded://?q=PAYLOAD')).toBe(false);
    expect(normalizeQrlConnectDeepLink('qrlconnect-embedded://?q=PAYLOAD')).toBeNull();
  });

  it('reads the schemes as a list whatever shape Expo reports', () => {
    // A jest run has no Expo config, so this only pins the shape: the caller
    // must always get an array it can search.
    expect(Array.isArray(configuredSchemes())).toBe(true);
  });
});
