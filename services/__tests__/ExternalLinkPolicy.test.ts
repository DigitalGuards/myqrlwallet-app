import { externalOpenDecision, isWalletOwnHost } from '../ExternalLinkPolicy';

describe('external link policy', () => {
  it('opens ordinary https links and the two inert handoff schemes', () => {
    for (const url of [
      'https://zondscan.com/tx/0xabc',
      'https://theqrl.org/',
      'mailto:security@qrlwallet.com',
      'tel:+3100000000',
    ]) {
      expect(externalOpenDecision(url)).toEqual({ action: 'open', url });
    }
  });

  it('refuses every scheme the app or the OS would act on', () => {
    // react-native-webview would hand all of these to Linking.openURL before
    // the component's own policy runs, including the app's pairing scheme.
    for (const url of [
      'qrlconnect://?q=PAYLOAD',
      'qrlconnect-embedded://?q=PAYLOAD',
      'intent://scan#Intent;scheme=zxing;end',
      'market://details?id=com.chiefdg.myqrlwallet',
      'itms-apps://apps.apple.com/app/id6758100237',
      'file:///etc/passwd',
      'content://media/external/images/media/1',
      'javascript:alert(1)',
      'data:text/html,<script>1</script>',
      'sms:+3100000000',
      'http://example.invalid/',
    ]) {
      expect(externalOpenDecision(url)).toEqual({ action: 'refuse', reason: 'scheme' });
    }
  });

  it('never sends the user to the live wallet', () => {
    for (const url of [
      'https://qrlwallet.com/',
      'https://www.qrlwallet.com/transfer',
      'https://QRLWallet.com/',
      'https://qrlwallet.com./',
    ]) {
      expect(externalOpenDecision(url)).toEqual({ action: 'refuse', reason: 'wallet-host' });
    }
  });

  it('refuses credentialed and malformed URLs', () => {
    expect(externalOpenDecision('https://user:pass@zondscan.com/')).toEqual({
      action: 'refuse',
      reason: 'credentials',
    });
    expect(externalOpenDecision('not a url')).toEqual({ action: 'refuse', reason: 'unparsable' });
    expect(externalOpenDecision('')).toEqual({ action: 'refuse', reason: 'length' });
    expect(externalOpenDecision(`https://zondscan.com/${'a'.repeat(9000)}`)).toEqual({
      action: 'refuse',
      reason: 'length',
    });
  });

  it('recognises the hosts the app serves the wallet from', () => {
    for (const url of [
      'https://qrlwallet.com/',
      'https://www.qrlwallet.com/x',
      'https://QRLWallet.com./y',
    ]) {
      expect(isWalletOwnHost(url)).toBe(true);
    }
    for (const url of ['https://zondscan.com/', 'https://qrlwallet.com.attacker.invalid/', 'junk']) {
      expect(isWalletOwnHost(url)).toBe(false);
    }
  });
});
