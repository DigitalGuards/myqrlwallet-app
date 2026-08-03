import Logger from '../Logger';
import {
  acceptQrlConnectDeepLink,
  isQrlConnectSystemUrl,
  normalizeQrlConnectDeepLink,
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
