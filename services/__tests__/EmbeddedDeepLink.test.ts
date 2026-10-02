import {
  embeddedHashRouteForWalletUrl,
  isWalletUniversalLink,
} from '../EmbeddedDeepLink';
import { normalizeQrlConnectDeepLink } from '../DAppDeepLink';

jest.mock('../Logger', () => ({ debug: jest.fn(), warn: jest.fn(), error: jest.fn() }));

describe('wallet universal link to embedded route', () => {
  it('maps known wallet paths onto hash routes', () => {
    const cases: Array<[string, string]> = [
      ['https://qrlwallet.com/', '#/'],
      ['https://qrlwallet.com', '#/'],
      ['https://qrlwallet.com/transfer', '#/transfer'],
      ['https://qrlwallet.com/transfer/', '#/transfer'],
      ['https://qrlwallet.com/tx-history', '#/tx-history'],
      ['https://qrlwallet.com/dapp-sessions', '#/dapp-sessions'],
      ['https://qrlwallet.com/address-book', '#/address-book'],
      ['https://qrlwallet.com:443/settings', '#/settings'],
      [
        'https://qrlwallet.com/nft/0x1234567890abcdef1234567890ABCDEF12345678/42',
        '#/nft/0x1234567890abcdef1234567890ABCDEF12345678/42',
      ],
    ];
    for (const [url, route] of cases) {
      expect(embeddedHashRouteForWalletUrl(url)).toBe(route);
    }
  });

  it('leaves the dApp pairing path to the unchanged DAPP_URI flow', () => {
    const connectUrl = 'https://qrlwallet.com/connect?q=PAYLOAD';
    expect(embeddedHashRouteForWalletUrl(connectUrl)).toBeNull();
    // The pairing link still normalizes to the qrlconnect URI the bridge sends.
    expect(normalizeQrlConnectDeepLink(connectUrl)).toBe('qrlconnect://?q=PAYLOAD');
  });

  it('refuses unknown paths instead of forwarding them into the wallet', () => {
    for (const url of [
      'https://qrlwallet.com/does-not-exist',
      'https://qrlwallet.com/transfer/extra',
      'https://qrlwallet.com/nft/0xdeadbeef/1',
      'https://qrlwallet.com/nft/0x1234567890abcdef1234567890abcdef12345678/notanumber',
    ]) {
      expect(embeddedHashRouteForWalletUrl(url)).toBeNull();
    }
  });

  it('refuses anything that is not an https qrlwallet.com link', () => {
    for (const url of [
      'http://qrlwallet.com/transfer',
      'https://qrlwallet.com.attacker.invalid/transfer',
      'https://attacker.invalid/transfer',
      'https://user:pass@qrlwallet.com/transfer',
      'https://qrlwallet.com:8443/transfer',
      'qrlconnect://?q=PAYLOAD',
      ' https://qrlwallet.com/transfer',
      `https://qrlwallet.com/${'a'.repeat(5000)}`,
      '',
    ]) {
      expect(embeddedHashRouteForWalletUrl(url)).toBeNull();
    }
  });

  it('recognises wallet links regardless of whether they map to a route', () => {
    expect(isWalletUniversalLink('https://qrlwallet.com/connect?q=PAYLOAD')).toBe(true);
    expect(isWalletUniversalLink('https://qrlwallet.com/does-not-exist')).toBe(true);
    expect(isWalletUniversalLink('https://zondscan.com/')).toBe(false);
  });
});
