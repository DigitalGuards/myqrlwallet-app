import {
  EMBEDDED_BASE_URL,
  classifyEmbeddedNavigation,
  type EmbeddedNavigationRequest,
} from '../EmbeddedNavigationPolicy';

const iosPending = { initialDocumentPending: true, platform: 'ios' };
const iosConsumed = { initialDocumentPending: false, platform: 'ios' };
const androidPending = { initialDocumentPending: true, platform: 'android' };
const androidConsumed = { initialDocumentPending: false, platform: 'android' };

const req = (url: string, extra: Partial<EmbeddedNavigationRequest> = {}) => ({ url, ...extra });

describe('embedded wallet navigation policy', () => {
  it('admits the injected document exactly once on iOS', () => {
    expect(classifyEmbeddedNavigation(req(EMBEDDED_BASE_URL), iosPending)).toEqual({
      action: 'allow',
      reason: 'initial-document',
    });
    expect(classifyEmbeddedNavigation(req('https://qrlwallet.com'), iosPending)).toEqual({
      action: 'allow',
      reason: 'initial-document',
    });
    expect(classifyEmbeddedNavigation(req(EMBEDDED_BASE_URL), iosConsumed)).toEqual({
      action: 'block',
      reason: 'repeat-document',
    });
  });

  it('never admits a base URL request on Android', () => {
    // loadDataWithBaseURL does not consult the guard there, so any base-URL
    // request that arrives is a navigation the page asked for.
    expect(classifyEmbeddedNavigation(req(EMBEDDED_BASE_URL), androidPending)).toEqual({
      action: 'block',
      reason: 'repeat-document',
    });
    expect(classifyEmbeddedNavigation(req(EMBEDDED_BASE_URL), androidConsumed)).toEqual({
      action: 'block',
      reason: 'repeat-document',
    });
  });

  it('allows fragment navigation inside the shipped document', () => {
    for (const url of [
      'https://qrlwallet.com/#/',
      'https://qrlwallet.com/#/transfer',
      'https://qrlwallet.com/#/nft/0x0000000000000000000000000000000000000001/7',
    ]) {
      for (const state of [iosConsumed, androidConsumed]) {
        expect(classifyEmbeddedNavigation(req(url), state)).toEqual({
          action: 'allow',
          reason: 'fragment',
        });
      }
    }
  });

  it('refuses a URL that only looks like a fragment of the document', () => {
    // Each of these parses with a hash and an empty-looking query but is a
    // real network navigation that would fetch the live page.
    for (const url of [
      'https://qrlwallet.com/?#/transfer',
      'https://qrlwallet.com?#/transfer',
      'https://qrlwallet.com#/transfer',
      'https://qrlwallet.com/index.html#/transfer',
      'https://qrlwallet.com:443/#/transfer',
      'https://QRLWALLET.com/#/transfer',
      'https://qrlwallet.com./#/transfer',
    ]) {
      expect(classifyEmbeddedNavigation(req(url), iosConsumed).action).toBe('block');
    }
  });

  it('refuses a reload, a history traversal and a form submission of the document', () => {
    // WebKit reloads a loadHTMLString page by fetching the base URL, so a
    // location.reload() from inside the wallet would pull the live page in.
    for (const navigationType of ['reload', 'backforward', 'formsubmit', 'formresubmit']) {
      expect(
        classifyEmbeddedNavigation(req(EMBEDDED_BASE_URL, { navigationType }), iosPending),
      ).toEqual({ action: 'block', reason: 'navigation-type' });
    }
  });

  it('lets the wallet walk its own hash history', () => {
    // A backforward within the fragment is the wallet moving between its own
    // hash routes, which is what an in-app back arrow does. Refusing it broke
    // that on iOS.
    for (const navigationType of ['backforward', 'formsubmit', 'formresubmit', 'click', 'other']) {
      expect(
        classifyEmbeddedNavigation(
          req('https://qrlwallet.com/#/transfer', { navigationType }),
          iosConsumed,
        ),
      ).toEqual({ action: 'allow', reason: 'fragment' });
    }
  });

  it('still refuses a reload even of a hash URL', () => {
    // WebKit refetches the base URL for a reload whatever the fragment says.
    expect(
      classifyEmbeddedNavigation(
        req('https://qrlwallet.com/#/transfer', { navigationType: 'reload' }),
        iosConsumed,
      ),
    ).toEqual({ action: 'block', reason: 'navigation-type' });
  });

  it('admits the injected document only as a top-frame click-free load', () => {
    expect(
      classifyEmbeddedNavigation(req(EMBEDDED_BASE_URL, { navigationType: 'other' }), iosPending),
    ).toEqual({ action: 'allow', reason: 'initial-document' });
    expect(
      classifyEmbeddedNavigation(req(EMBEDDED_BASE_URL, { navigationType: 'click' }), iosPending),
    ).toEqual({ action: 'block', reason: 'navigation-type' });
  });

  it('refuses any navigation that reports itself as a subframe', () => {
    for (const url of [EMBEDDED_BASE_URL, 'https://qrlwallet.com/#/transfer', 'https://zondscan.com/']) {
      expect(classifyEmbeddedNavigation(req(url, { isTopFrame: false }), iosPending)).toEqual({
        action: 'block',
        reason: 'subframe',
      });
    }
  });

  it('never loads a live qrlwallet.com document and never bounces one to the browser', () => {
    for (const url of [
      'https://qrlwallet.com/transfer',
      'https://qrlwallet.com/index.html',
      'https://qrlwallet.com/?redirect=1',
      'https://qrlwallet.com/connect?q=payload',
      'https://qrlwallet.com./',
    ]) {
      const decision = classifyEmbeddedNavigation(req(url), iosConsumed);
      expect(decision.action).toBe('block');
    }
  });

  it('hands every other http and https origin to the system browser', () => {
    for (const url of [
      'https://zondscan.com/tx/0xabc',
      'https://theqrl.org',
      'http://example.invalid/page',
      'https://qrlwallet.com.attacker.invalid/',
    ]) {
      expect(classifyEmbeddedNavigation(req(url), iosConsumed)).toEqual({ action: 'open-external' });
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
      expect(classifyEmbeddedNavigation(req(url), iosPending).action).toBe('block');
    }
  });

  it('refuses an http downgrade or an alternate port on the wallet host', () => {
    for (const url of ['http://qrlwallet.com/', 'https://qrlwallet.com:8443/']) {
      expect(classifyEmbeddedNavigation(req(url), iosPending)).toEqual({
        action: 'block',
        reason: 'same-origin-path',
      });
    }
  });

  it('allows the WebView own empty documents', () => {
    expect(classifyEmbeddedNavigation(req('about:blank'), iosConsumed)).toEqual({
      action: 'allow',
      reason: 'webview-internal',
    });
    expect(classifyEmbeddedNavigation(req('about:srcdoc'), iosConsumed)).toEqual({
      action: 'allow',
      reason: 'webview-internal',
    });
  });

  it('rejects an oversized URL without parsing it', () => {
    const huge = `https://qrlwallet.com/#/${'a'.repeat(9000)}`;
    expect(classifyEmbeddedNavigation(req(huge), iosConsumed).action).toBe('block');
  });
});
