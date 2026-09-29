import {
  EMBEDDED_BASE_URL,
  classifyEmbeddedNavigation,
} from '../EmbeddedNavigationPolicy';

const pending = { initialDocumentPending: true };
const consumed = { initialDocumentPending: false };

describe('embedded wallet navigation policy', () => {
  it('admits the injected document exactly once per load', () => {
    expect(classifyEmbeddedNavigation(EMBEDDED_BASE_URL, pending)).toEqual({
      action: 'allow',
      reason: 'initial-document',
    });
    expect(classifyEmbeddedNavigation('https://qrlwallet.com', pending)).toEqual({
      action: 'allow',
      reason: 'initial-document',
    });
    expect(classifyEmbeddedNavigation(EMBEDDED_BASE_URL, consumed)).toEqual({
      action: 'block',
      reason: 'repeat-document',
    });
  });

  it('allows fragment navigation inside the shipped document', () => {
    for (const url of [
      'https://qrlwallet.com/#/',
      'https://qrlwallet.com/#/transfer',
      'https://qrlwallet.com#/settings',
      'https://qrlwallet.com/#/nft/0x0000000000000000000000000000000000000001/7',
    ]) {
      expect(classifyEmbeddedNavigation(url, consumed)).toEqual({
        action: 'allow',
        reason: 'fragment',
      });
    }
  });

  it('never loads a live qrlwallet.com document and never bounces one to the browser', () => {
    for (const url of [
      'https://qrlwallet.com/transfer',
      'https://qrlwallet.com/index.html',
      'https://qrlwallet.com/?redirect=1',
      'https://qrlwallet.com/connect?q=payload',
    ]) {
      const decision = classifyEmbeddedNavigation(url, consumed);
      expect(decision.action).toBe('block');
      expect(decision).not.toEqual(expect.objectContaining({ action: 'open-external' }));
    }
  });

  it('hands every other http and https origin to the system browser', () => {
    for (const url of [
      'https://zondscan.com/tx/0xabc',
      'https://theqrl.org',
      'http://example.invalid/page',
      'https://qrlwallet.com.attacker.invalid/',
    ]) {
      expect(classifyEmbeddedNavigation(url, consumed)).toEqual({ action: 'open-external' });
    }
  });

  it('refuses non-http schemes, credentialed URLs and junk', () => {
    for (const url of [
      'file:///wallet/index.html',
      'javascript:alert(1)',
      'data:text/html,<script>1</script>',
      'qrlconnect://?q=payload',
      'intent://qrlwallet.com#Intent;scheme=https;end',
      'https://user:pass@qrlwallet.com/',
      'not a url',
      '',
    ]) {
      expect(classifyEmbeddedNavigation(url, pending).action).toBe('block');
    }
  });

  it('refuses an http downgrade or an alternate port on the wallet host', () => {
    for (const url of [
      'http://qrlwallet.com/',
      'https://qrlwallet.com:8443/',
      'http://qrlwallet.com/#/transfer',
    ]) {
      expect(classifyEmbeddedNavigation(url, pending)).toEqual({
        action: 'block',
        reason: 'same-origin-path',
      });
    }
  });

  it('allows the WebView own empty documents', () => {
    expect(classifyEmbeddedNavigation('about:blank', consumed)).toEqual({
      action: 'allow',
      reason: 'webview-internal',
    });
    expect(classifyEmbeddedNavigation('about:srcdoc', consumed)).toEqual({
      action: 'allow',
      reason: 'webview-internal',
    });
  });

  it('rejects an oversized URL without parsing it', () => {
    const huge = `https://qrlwallet.com/#/${'a'.repeat(9000)}`;
    expect(classifyEmbeddedNavigation(huge, consumed).action).toBe('block');
  });
});
