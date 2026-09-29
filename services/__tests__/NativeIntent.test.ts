import { redirectSystemPath } from '../../app/+native-intent';

describe('native deep-link routing boundary', () => {
  it('keeps pairing schemes out of route parsing even when the bridge will reject their case', () => {
    expect(
      redirectSystemPath({ path: 'qrlconnect://?q=ABC%25DEF', initial: true }),
    ).toBe('/');
    expect(
      redirectSystemPath({ path: 'QrLcOnNeCt://?q=ABC%25DEF', initial: true }),
    ).toBe('/');
  });

  it('drops oversized malformed payloads before query decoding', () => {
    for (const prefix of ['qrlconnect://?q=', 'QrLcOnNeCt://?q=', '/settings?q=']) {
      expect(redirectSystemPath({ path: prefix + '%C0%AF'.repeat(1000), initial: true })).toBe('/');
    }
  });

  it('retains bounded local routes and bypasses verified connect links', () => {
    expect(redirectSystemPath({ path: '/settings', initial: false })).toBe('/settings');
    expect(redirectSystemPath({ path: 'https://qrlwallet.com/connect?q=%FF', initial: false })).toBe('/');
  });

  it('lands every wallet universal link on the WebView tab', () => {
    for (const path of [
      'https://qrlwallet.com',
      'https://qrlwallet.com/',
      'https://qrlwallet.com/transfer',
      'https://qrlwallet.com:443/tx-history',
      'https://qrlwallet.com/?ref=email',
      'https://QRLWALLET.com/settings',
    ]) {
      expect(redirectSystemPath({ path, initial: true })).toBe('/');
    }
  });

  it('leaves links for other hosts alone', () => {
    expect(redirectSystemPath({ path: 'https://qrlwallet.com.attacker.invalid/transfer', initial: true }))
      .toBe('https://qrlwallet.com.attacker.invalid/transfer');
  });
});
