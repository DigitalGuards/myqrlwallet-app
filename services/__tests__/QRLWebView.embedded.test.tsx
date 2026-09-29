import React, { act, createRef } from 'react';
import { Linking, Platform } from 'react-native';
import { create, type ReactTestRenderer } from 'react-test-renderer';
import QRLWebView, { type QRLWebViewRef } from '../../components/QRLWebView';
import NativeBridge from '../NativeBridge';

// Carries the markers a v3 frontend build bakes in, so the profile gate in
// QRLWebView lets it through. EmbeddedWalletProfile.test.ts covers the gate.
const V3_MARKERS =
  '<script>var n={chainId:"0x301825",genesisHash:' +
  '"0xd15407991193e6c23b733dc6bf9c628deaff8f9b6e252aa0d60030952b3e3ea4"};' +
  'var k="qrlwallet:v3:"+key;</script>';
const EMBEDDED_HTML =
  `<!doctype html><html lang="en"><head><title>wallet</title>${V3_MARKERS}</head><body></body></html>`;

jest.mock('react-native-webview', () => ({ WebView: 'NativeWebView' }));
jest.mock('@react-navigation/native', () => ({ useFocusEffect: jest.fn() }));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('expo-constants', () => ({ expoConfig: { version: '1.4.2' } }));
jest.mock('../../components/QuantumLoadingScreen', () => 'QuantumLoadingScreen');
jest.mock('../Logger', () => ({ debug: jest.fn(), warn: jest.fn(), error: jest.fn() }));
jest.mock('../EmbeddedStorageMigration', () => {
  const actual = jest.requireActual('../EmbeddedStorageMigration.ts') as Record<string, unknown>;
  return {
    ...actual,
    isStorageMigrationPending: jest.fn().mockResolvedValue(true),
    markStorageMigrationDone: jest.fn().mockResolvedValue(undefined),
  };
});
jest.mock('../NativeBridge', () => ({
  setWebViewRef: jest.fn(),
  resetWebAppReady: jest.fn(),
  sendQRResult: jest.fn(),
  handle: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../EmbeddedWalletDocument', () => {
  const actual = jest.requireActual('../EmbeddedWalletDocument.ts') as Record<string, unknown>;
  // jest-expo's expo-crypto returns zero bytes, so a real token would be the
  // same string every time and a re-serve would be indistinguishable from the
  // document it replaced. Counting here keeps each load distinguishable.
  let minted = 0;
  return {
    ...actual,
    createDocumentToken: jest.fn(() => {
      minted += 1;
      return minted.toString(16).padStart(64, '0');
    }),
    loadEmbeddedWalletHtml: jest.fn(),
  };
});

const { loadEmbeddedWalletHtml } = jest.requireMock('../EmbeddedWalletDocument') as {
  loadEmbeddedWalletHtml: jest.Mock;
};
const { BRIDGE_TOKEN_SEPARATOR } = jest.requireActual('../EmbeddedWalletDocument.ts') as {
  BRIDGE_TOKEN_SEPARATOR: string;
};
const { markStorageMigrationDone, isStorageMigrationPending } = jest.requireMock(
  '../EmbeddedStorageMigration',
) as { markStorageMigrationDone: jest.Mock; isStorageMigrationPending: jest.Mock };

/** The token the component minted for the document currently on screen. */
const documentTokenFrom = (html: string): string => {
  const match = /var t="([0-9a-f]{64})/.exec(html);
  if (!match) throw new Error('no document token in the served html');
  return match[1];
};

describe('embedded QRLWebView', () => {
  let screen: ReactTestRenderer;
  const runtime = globalThis as typeof globalThis & { __DEV__: boolean };
  const originalDev = __DEV__;

  const webViewNodeMock = {
    injectJavaScript: jest.fn(),
    reload: jest.fn(),
    goBack: jest.fn(),
    clearCache: jest.fn(),
  };

  const renderEmbedded = async (ref?: React.Ref<QRLWebViewRef>) => {
    await act(async () => {
      screen = create(<QRLWebView ref={ref} webSource="embedded" />, {
        createNodeMock: () => webViewNodeMock,
      });
    });
    // Let the document read settle.
    await act(async () => {
      await Promise.resolve();
    });
    return screen.root.findByType('NativeWebView' as never);
  };

  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    runtime.__DEV__ = false;
    webViewNodeMock.injectJavaScript.mockClear();
    webViewNodeMock.clearCache.mockClear();
    loadEmbeddedWalletHtml.mockResolvedValue(EMBEDDED_HTML);
    isStorageMigrationPending.mockResolvedValue(true);
  });
  afterEach(async () => {
    jest.restoreAllMocks();
    if (screen) await act(async () => screen.unmount());
    runtime.__DEV__ = originalDev;
    jest.useRealTimers();
  });

  it('serves the bundled document under the production base URL', async () => {
    const view = await renderEmbedded();
    expect(view.props.source).toEqual({
      html: expect.stringContaining('window.__QRL_EMBEDDED__ = true;') as unknown as string,
      baseUrl: 'https://qrlwallet.com/',
    });
    // The bootstrap has to be the first script in the head, ahead of the
    // wallet's own scripts.
    const html = view.props.source.html as string;
    expect(html).toContain('<head><script>(function(){window.__QRL_EMBEDDED__ = true;');
    expect(html.indexOf('__QRL_EMBEDDED__')).toBeLessThan(html.indexOf('<title>'));
    // Deliberately open: react-native-webview opens anything outside this
    // list with Linking.openURL before the component sees it, so widening it
    // is what makes the navigation policy the only gate.
    expect(view.props.originWhitelist).toEqual(['*']);
    expect(view.props.mixedContentMode).toBe('never');
    expect(view.props.userAgent).toContain('MyQRLWallet/1.4.2');
  });

  it('sets the embedded flag through the before-content hook as well', async () => {
    const view = await renderEmbedded();
    expect(view.props.injectedJavaScriptBeforeContentLoaded).toContain(
      'window.__QRL_EMBEDDED__ = true;',
    );
  });

  it('keeps the Android capability script alongside the embedded flag', async () => {
    jest.replaceProperty(Platform, 'OS', 'android');
    const view = await renderEmbedded();
    expect(view.props.injectedJavaScriptBeforeContentLoaded).toContain(
      'window.__QRL_EMBEDDED__ = true;',
    );
    expect(view.props.injectedJavaScriptBeforeContentLoaded).toContain('injectedObjectJson');
    expect(view.props.injectedJavaScript).toContain('injectedObjectJson');
    expect(view.props.injectedJavaScriptObject).toEqual(
      expect.objectContaining({ qrlWalletCapabilities: expect.any(Object) }),
    );
  });

  it('admits the injected document once and every fragment, and refuses a live reload', async () => {
    const view = await renderEmbedded();
    const guard = view.props.onShouldStartLoadWithRequest;
    expect(guard({ url: 'https://qrlwallet.com/' })).toBe(true);
    expect(guard({ url: 'https://qrlwallet.com/#/transfer' })).toBe(true);
    expect(guard({ url: 'https://qrlwallet.com/' })).toBe(false);
    expect(guard({ url: 'https://qrlwallet.com/transfer' })).toBe(false);
  });

  it('never admits a base URL navigation on Android', async () => {
    // loadDataWithBaseURL does not go through shouldOverrideUrlLoading, so any
    // base-URL request that reaches the guard is a navigation the page asked
    // for and would fetch the live page.
    jest.replaceProperty(Platform, 'OS', 'android');
    const view = await renderEmbedded();
    expect(view.props.onShouldStartLoadWithRequest({ url: 'https://qrlwallet.com/' })).toBe(false);
    await act(async () => view.props.onLoadStart({ nativeEvent: { loading: true } }));
    expect(view.props.onShouldStartLoadWithRequest({ url: 'https://qrlwallet.com/' })).toBe(false);
    // A hash route inside the document is still fine.
    expect(
      view.props.onShouldStartLoadWithRequest({ url: 'https://qrlwallet.com/#/transfer' }),
    ).toBe(true);
  });

  it('refuses a reload navigation that would fetch the live page', async () => {
    const view = await renderEmbedded();
    for (const navigationType of ['reload', 'backforward', 'formsubmit', 'formresubmit']) {
      expect(
        view.props.onShouldStartLoadWithRequest({
          url: 'https://qrlwallet.com/#/transfer',
          navigationType,
        }),
      ).toBe(false);
    }
  });

  it('admits the document again after a recovery reload on iOS only', async () => {
    const ref = createRef<QRLWebViewRef>();
    const view = await renderEmbedded(ref);
    view.props.onShouldStartLoadWithRequest({ url: 'https://qrlwallet.com/' });
    expect(view.props.onShouldStartLoadWithRequest({ url: 'https://qrlwallet.com/' })).toBe(false);
    await act(async () => ref.current?.reload());
    const reloaded = screen.root.findByType('NativeWebView' as never);
    expect(reloaded.props.onShouldStartLoadWithRequest({ url: 'https://qrlwallet.com/' })).toBe(true);
  });

  it('opens a foreign origin outside the app instead of loading it', async () => {
    const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    const view = await renderEmbedded();
    expect(view.props.onShouldStartLoadWithRequest({ url: 'https://zondscan.com/tx/0x1' })).toBe(false);
    expect(openURL).toHaveBeenCalledWith('https://zondscan.com/tx/0x1');
  });

  it('refuses to hand a scheme the OS would act on to Linking', async () => {
    const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    const view = await renderEmbedded();
    for (const url of ['qrlconnect://?q=PAYLOAD', 'intent://x#Intent;scheme=https;end', 'tel:+31']) {
      expect(view.props.onShouldStartLoadWithRequest({ url })).toBe(false);
    }
    expect(openURL).not.toHaveBeenCalled();
  });

  it('never hands a qrlwallet.com document to the system browser', async () => {
    const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    const view = await renderEmbedded();
    const guard = view.props.onShouldStartLoadWithRequest;
    guard({ url: 'https://qrlwallet.com/' });
    expect(guard({ url: 'https://qrlwallet.com/' })).toBe(false);
    expect(guard({ url: 'https://qrlwallet.com/transfer' })).toBe(false);
    expect(openURL).not.toHaveBeenCalled();
  });

  it('re-serves the document after the content process dies', async () => {
    const view = await renderEmbedded();
    const servedToken = documentTokenFrom(view.props.source.html as string);
    // The guard has consumed the one allowed base-URL load.
    view.props.onShouldStartLoadWithRequest({ url: 'https://qrlwallet.com/' });
    expect(view.props.onShouldStartLoadWithRequest({ url: 'https://qrlwallet.com/' })).toBe(false);

    await act(async () => view.props.onContentProcessDidTerminate());
    expect(NativeBridge.resetWebAppReady).toHaveBeenCalled();

    const recovered = screen.root.findByType('NativeWebView' as never);
    expect(recovered.props.source.baseUrl).toBe('https://qrlwallet.com/');
    // The same document, with a fresh token.
    expect(documentTokenFrom(recovered.props.source.html as string)).not.toBe(servedToken);
    // A fresh document load is admitted again.
    expect(recovered.props.onShouldStartLoadWithRequest({ url: 'https://qrlwallet.com/' })).toBe(true);
  });

  it('recovers the same way from an Android render process death', async () => {
    jest.replaceProperty(Platform, 'OS', 'android');
    const view = await renderEmbedded();
    expect(typeof view.props.onRenderProcessGone).toBe('function');
    const servedToken = documentTokenFrom(view.props.source.html as string);
    view.props.onShouldStartLoadWithRequest({ url: 'https://qrlwallet.com/' });
    await act(async () => view.props.onRenderProcessGone({ nativeEvent: { didCrash: true } }));
    const recovered = screen.root.findByType('NativeWebView' as never);
    // Android recovery re-serves the string through loadDataWithBaseURL, which
    // never consults the guard, so the base URL stays refused there.
    expect(recovered.props.source.baseUrl).toBe('https://qrlwallet.com/');
    expect(documentTokenFrom(recovered.props.source.html as string)).not.toBe(servedToken);
    expect(recovered.props.onShouldStartLoadWithRequest({ url: 'https://qrlwallet.com/' })).toBe(false);
    expect(
      recovered.props.onShouldStartLoadWithRequest({ url: 'https://qrlwallet.com/#/' }),
    ).toBe(true);
  });

  it('reloads through the ref by handing the document over again', async () => {
    const ref = createRef<QRLWebViewRef>();
    const view = await renderEmbedded(ref);
    view.props.onShouldStartLoadWithRequest({ url: 'https://qrlwallet.com/' });
    await act(async () => ref.current?.reload());
    const reloaded = screen.root.findByType('NativeWebView' as never);
    expect(reloaded.props.onShouldStartLoadWithRequest({ url: 'https://qrlwallet.com/' })).toBe(true);
  });

  it('applies a deep-link route as a fragment change and refuses anything else', async () => {
    const ref = createRef<QRLWebViewRef>();
    await renderEmbedded(ref);
    expect(ref.current?.navigateToEmbeddedRoute('#/transfer')).toBe(true);
    expect(webViewNodeMock.injectJavaScript).toHaveBeenCalledTimes(1);
    const script = webViewNodeMock.injectJavaScript.mock.calls[0][0] as string;
    expect(script).toContain('window.location.hash="/transfer"');

    webViewNodeMock.injectJavaScript.mockClear();
    webViewNodeMock.clearCache.mockClear();
    for (const route of [
      '/transfer',
      '#/transfer";window.stealSeed()//',
      '#/transfer?x=<script>',
      `#/${'a'.repeat(300)}`,
      'javascript:alert(1)',
    ]) {
      expect(ref.current?.navigateToEmbeddedRoute(route)).toBe(false);
    }
    expect(webViewNodeMock.injectJavaScript).not.toHaveBeenCalled();
  });

  it('does not route the document in remote mode', async () => {
    const ref = createRef<QRLWebViewRef>();
    await act(async () => {
      screen = create(<QRLWebView ref={ref} webSource="remote" />, {
        createNodeMock: () => webViewNodeMock,
      });
    });
    expect(ref.current?.navigateToEmbeddedRoute('#/transfer')).toBe(false);
    expect(webViewNodeMock.injectJavaScript).not.toHaveBeenCalled();
  });

  it('refuses a bundled wallet built for another network', async () => {
    // Without this gate the mismatch only surfaces as a failed seed backup,
    // after the user has imported a seed and set a transaction PIN.
    loadEmbeddedWalletHtml.mockResolvedValue(
      '<!doctype html><html><head><title>v2</title></head><body></body></html>',
    );
    await act(async () => {
      screen = create(<QRLWebView webSource="embedded" />, {
        createNodeMock: () => webViewNodeMock,
      });
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.root.findAllByType('NativeWebView' as never)).toHaveLength(0);
    const text = JSON.stringify(screen.toJSON());
    expect(text).toContain('wrong network');
    expect(text).toContain('TEST_NET_V3');
  });

  it('accepts a bridge message only when it carries the document token', async () => {
    // The origin check accepts any document on qrlwallet.com, so the token is
    // what ties bridge authority to the document this app actually served.
    const view = await renderEmbedded();
    const token = documentTokenFrom(view.props.source.html as string);
    const message = JSON.stringify({ type: 'SEED_STORED', payload: { address: 'Q00' } });

    (NativeBridge.handle as jest.Mock).mockClear();
    await act(async () =>
      view.props.onMessage({
        nativeEvent: { data: message, url: 'https://qrlwallet.com/' },
      }),
    );
    expect(NativeBridge.handle).not.toHaveBeenCalled();

    await act(async () =>
      view.props.onMessage({
        nativeEvent: {
          data: `${'f'.repeat(64)}${BRIDGE_TOKEN_SEPARATOR}${message}`,
          url: 'https://qrlwallet.com/',
        },
      }),
    );
    expect(NativeBridge.handle).not.toHaveBeenCalled();

    await act(async () =>
      view.props.onMessage({
        nativeEvent: {
          data: `${token}${BRIDGE_TOKEN_SEPARATOR}${message}`,
          url: 'https://qrlwallet.com/',
        },
      }),
    );
    expect(NativeBridge.handle).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'SEED_STORED' }),
    );
  });

  it('re-serves the rebind script so a late bridge still gets bound', async () => {
    const view = await renderEmbedded();
    expect(view.props.injectedJavaScript).toContain('__qrlBindBridge');
    // The rebind script must carry no token: injected scripts run in every
    // document the WebView loads, including one that is not ours.
    expect(view.props.injectedJavaScript).not.toMatch(/[0-9a-f]{64}/);
    expect(view.props.injectedJavaScriptBeforeContentLoaded).not.toMatch(/[0-9a-f]{64}/);
  });

  it('takes a bridge message in remote mode without any token', async () => {
    await act(async () => {
      screen = create(<QRLWebView webSource="remote" />, {
        createNodeMock: () => webViewNodeMock,
      });
    });
    const view = screen.root.findByType('NativeWebView' as never);
    (NativeBridge.handle as jest.Mock).mockClear();
    await act(async () =>
      view.props.onMessage({
        nativeEvent: {
          data: JSON.stringify({ type: 'SEED_STORED', payload: {} }),
          url: 'https://qrlwallet.com/',
        },
      }),
    );
    expect(NativeBridge.handle).toHaveBeenCalledTimes(1);
  });

  it('pushes a second document in one load back out', async () => {
    // Android reports no navigation type, so a page-initiated reload of a
    // hash URL satisfies the fragment rule. What it cannot fake is being the
    // only document this load served. The native interceptor is the first
    // layer; this is the second.
    jest.replaceProperty(Platform, 'OS', 'android');
    const view = await renderEmbedded();
    const servedToken = documentTokenFrom(view.props.source.html as string);
    await act(async () =>
      view.props.onLoadStart({ nativeEvent: { newDocument: true, loading: true } }),
    );
    expect(NativeBridge.resetWebAppReady).toHaveBeenCalledTimes(1);

    await act(async () =>
      view.props.onLoadStart({ nativeEvent: { newDocument: true, loading: true } }),
    );
    const recovered = screen.root.findByType('NativeWebView' as never);
    expect(recovered.props.source.baseUrl).toBe('https://qrlwallet.com/');
    // A fresh token, so a message held by the document that was pushed out
    // cannot be replayed into the one that replaced it.
    expect(documentTokenFrom(recovered.props.source.html as string)).not.toBe(servedToken);
    expect(NativeBridge.resetWebAppReady).toHaveBeenCalledTimes(2);
  });

  it('leaves the wallet router alone when it replaces state during module init', async () => {
    // The regression that put the app on the error screen on every cold
    // start: React Router calls history.replaceState while the page is still
    // loading, and that event arrives with loading:true.
    jest.replaceProperty(Platform, 'OS', 'android');
    const view = await renderEmbedded();
    const servedToken = documentTokenFrom(view.props.source.html as string);
    await act(async () =>
      view.props.onLoadStart({ nativeEvent: { newDocument: true, loading: true } }),
    );
    for (let update = 0; update < 5; update += 1) {
      await act(async () =>
        view.props.onLoadStart({ nativeEvent: { newDocument: false, loading: true } }),
      );
    }
    const same = screen.root.findByType('NativeWebView' as never);
    expect(documentTokenFrom(same.props.source.html as string)).toBe(servedToken);
    expect(NativeBridge.resetWebAppReady).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(screen.toJSON())).not.toContain('replaced by another page');
  });

  it('ignores a dying view trailing history update after the epoch moved on', async () => {
    // The exact device sequence. A reload makes the epoch-N view foreign, the
    // guard remounts, and the old view then delivers its own
    // doUpdateVisitedHistory. Before the epoch check that late event claimed
    // the new document's first-load slot, so the replacement's real
    // onPageStarted looked like a second document and the counter climbed to
    // the error screen on about one reload in two.
    jest.replaceProperty(Platform, 'OS', 'android');
    const first = await renderEmbedded();
    // Captured while the view is still mounted: react-test-renderer drops the
    // props of a removed node, and the point here is a callback that outlives
    // the view that raised it.
    const firstLoadStart = first.props.onLoadStart as (event: unknown) => void;
    await act(async () => firstLoadStart({ nativeEvent: { newDocument: true, loading: true } }));
    // The page reloads itself: a second document start for this epoch.
    await act(async () => firstLoadStart({ nativeEvent: { newDocument: true, loading: true } }));
    const second = screen.root.findByType('NativeWebView' as never);
    const secondToken = documentTokenFrom(second.props.source.html as string);

    // The dying view's trailing event, delivered after the remount.
    await act(async () => firstLoadStart({ nativeEvent: { newDocument: false, loading: true } }));
    // The replacement's real document start must be accepted, not counted.
    await act(async () =>
      second.props.onLoadStart({ nativeEvent: { newDocument: true, loading: true } }),
    );

    const settled = screen.root.findByType('NativeWebView' as never);
    expect(documentTokenFrom(settled.props.source.html as string)).toBe(secondToken);
    expect(JSON.stringify(screen.toJSON())).not.toContain('replaced by another page');
  });

  it('keeps a dying view from spending the replacement document allowance', async () => {
    // iOS admits the injected document once per load, and the guard spends
    // that allowance. A navigation request from the view being replaced would
    // otherwise consume the allowance belonging to its replacement, so the
    // replacement's own loadHTMLString would be refused and the screen would
    // stay blank.
    const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    const ref = createRef<QRLWebViewRef>();
    const first = await renderEmbedded(ref);
    const staleGuard = first.props.onShouldStartLoadWithRequest as (
      request: { url: string },
    ) => boolean;
    // The first view uses its own allowance.
    expect(staleGuard({ url: 'https://qrlwallet.com/' })).toBe(true);

    await act(async () => ref.current?.reload());
    const second = screen.root.findByType('NativeWebView' as never);

    // The dying view asks to navigate after the remount.
    expect(staleGuard({ url: 'https://qrlwallet.com/' })).toBe(false);
    expect(staleGuard({ url: 'https://qrlwallet.com/#/transfer' })).toBe(false);
    expect(staleGuard({ url: 'https://zondscan.com/' })).toBe(false);
    // And a view on its way out cannot launch the browser either.
    expect(openURL).not.toHaveBeenCalled();

    // The replacement's own document load is still admitted.
    expect(second.props.onShouldStartLoadWithRequest({ url: 'https://qrlwallet.com/' })).toBe(true);
  });

  it('drops every callback from a view that is no longer on screen', async () => {
    jest.replaceProperty(Platform, 'OS', 'android');
    const first = await renderEmbedded();
    const stale = {
      loadStart: first.props.onLoadStart as (event: unknown) => void,
      error: first.props.onError as (event: unknown) => void,
      terminate: first.props.onContentProcessDidTerminate as () => void,
      loadEnd: first.props.onLoadEnd as () => void,
    };
    await act(async () => stale.loadStart({ nativeEvent: { newDocument: true, loading: true } }));
    await act(async () => stale.loadStart({ nativeEvent: { newDocument: true, loading: true } }));
    const second = screen.root.findByType('NativeWebView' as never);
    const secondToken = documentTokenFrom(second.props.source.html as string);

    // A stale error would blank the wallet, and a stale terminate would
    // remount the document that just replaced it.
    await act(async () => stale.error({ nativeEvent: { description: 'stale failure' } }));
    await act(async () => stale.terminate());
    await act(async () => stale.loadEnd());

    const settled = screen.root.findByType('NativeWebView' as never);
    expect(documentTokenFrom(settled.props.source.html as string)).toBe(secondToken);
    expect(JSON.stringify(screen.toJSON())).not.toContain('stale failure');
  });

  it('survives repeated reloads once each new document binds the bridge', async () => {
    // The counter used to be reset only by Retry, so a fourth well-spaced
    // reload over the app's lifetime reached the error screen.
    jest.replaceProperty(Platform, 'OS', 'android');
    let view = await renderEmbedded();
    await act(async () =>
      view.props.onLoadStart({ nativeEvent: { newDocument: true, loading: true } }),
    );
    for (let reload = 0; reload < 6; reload += 1) {
      await act(async () =>
        view.props.onLoadStart({ nativeEvent: { newDocument: true, loading: true } }),
      );
      view = screen.root.findByType('NativeWebView' as never);
      await act(async () =>
        view.props.onLoadStart({ nativeEvent: { newDocument: true, loading: true } }),
      );
      // The replacement proves it is ours.
      const token = documentTokenFrom(view.props.source.html as string);
      await act(async () =>
        view.props.onMessage({
          nativeEvent: {
            data: `${token}${BRIDGE_TOKEN_SEPARATOR}${JSON.stringify({ type: 'WEB_APP_READY' })}`,
            url: 'https://qrlwallet.com/',
          },
        }),
      );
    }
    expect(screen.root.findAllByType('NativeWebView' as never)).toHaveLength(1);
    expect(JSON.stringify(screen.toJSON())).not.toContain('replaced by another page');
  });

  it('gives up loudly if a foreign document keeps coming back', async () => {
    jest.replaceProperty(Platform, 'OS', 'android');
    await renderEmbedded();
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const current = screen.root.findAllByType('NativeWebView' as never)[0];
      if (!current) break;
      // One accepted document start, then a second one in the same load.
      await act(async () =>
        current.props.onLoadStart({ nativeEvent: { newDocument: true, loading: true } }),
      );
      await act(async () =>
        current.props.onLoadStart({ nativeEvent: { newDocument: true, loading: true } }),
      );
    }
    expect(screen.root.findAllByType('NativeWebView' as never)).toHaveLength(0);
    expect(JSON.stringify(screen.toJSON())).toContain('replaced by another page');
  });

  it('leaves an Android same-document history update alone', async () => {
    jest.replaceProperty(Platform, 'OS', 'android');
    const view = await renderEmbedded();
    const servedToken = documentTokenFrom(view.props.source.html as string);
    await act(async () => view.props.onLoadStart({ nativeEvent: { loading: true } }));
    // The wallet's own hash routes report loading:false on a loaded page, and
    // an unpatched build has no tag to read.
    await act(async () => view.props.onLoadStart({ nativeEvent: { loading: false } }));
    const same = screen.root.findByType('NativeWebView' as never);
    expect(documentTokenFrom(same.props.source.html as string)).toBe(servedToken);
    expect(NativeBridge.resetWebAppReady).toHaveBeenCalledTimes(1);
  });

  it('tells the document whether it still owes the inherited storage pass', async () => {
    const view = await renderEmbedded();
    expect(view.props.source.html).toContain('window.__QRL_EMBEDDED_MIGRATION__ = true;');
  });

  it('tells an already migrated install it owes nothing', async () => {
    isStorageMigrationPending.mockResolvedValue(false);
    const view = await renderEmbedded();
    expect(view.props.source.html).toContain('window.__QRL_EMBEDDED_MIGRATION__ = false;');
    // And it does not clear caches on a launch that has already been through.
    expect(webViewNodeMock.clearCache).not.toHaveBeenCalled();
  });

  it('runs the whole handshake once for an upgraded install', async () => {
    const view = await renderEmbedded();
    const token = documentTokenFrom(view.props.source.html as string);
    expect(view.props.source.html).toContain('window.__QRL_EMBEDDED_MIGRATION__ = true;');

    // The caches half runs natively once the document is up.
    await act(async () => view.props.onLoadEnd());
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(webViewNodeMock.clearCache).toHaveBeenCalledWith(true);
    expect(webViewNodeMock.injectJavaScript).toHaveBeenCalledWith(
      expect.stringContaining('serviceWorker') as unknown as string,
    );
    expect(markStorageMigrationDone).not.toHaveBeenCalled();

    // The page clears its own sessions and says so.
    const ack = `${token}${BRIDGE_TOKEN_SEPARATOR}${JSON.stringify({
      type: 'EMBEDDED_MIGRATION_DONE',
    })}`;
    await act(async () => view.props.onMessage({ nativeEvent: { data: ack, url: 'https://qrlwallet.com/' } }));
    expect(markStorageMigrationDone).toHaveBeenCalledTimes(1);

    // A repeat acknowledgement does not record it twice.
    await act(async () => view.props.onMessage({ nativeEvent: { data: ack, url: 'https://qrlwallet.com/' } }));
    expect(markStorageMigrationDone).toHaveBeenCalledTimes(2);
    expect(NativeBridge.handle).not.toHaveBeenCalled();
  });

  it('records the migration only once the page acknowledges it', async () => {
    const view = await renderEmbedded();
    const token = documentTokenFrom(view.props.source.html as string);
    expect(markStorageMigrationDone).not.toHaveBeenCalled();
    await act(async () =>
      view.props.onMessage({
        nativeEvent: {
          data: `${token}${BRIDGE_TOKEN_SEPARATOR}${JSON.stringify({
            type: 'EMBEDDED_MIGRATION_DONE',
          })}`,
          url: 'https://qrlwallet.com/',
        },
      }),
    );
    expect(markStorageMigrationDone).toHaveBeenCalledTimes(1);
    // It is not a bridge message: NativeBridge never sees it.
    expect(NativeBridge.handle).not.toHaveBeenCalled();
  });

  it('ignores an acknowledgement that does not carry the document token', async () => {
    const view = await renderEmbedded();
    await act(async () =>
      view.props.onMessage({
        nativeEvent: {
          data: JSON.stringify({ type: 'EMBEDDED_MIGRATION_DONE' }),
          url: 'https://qrlwallet.com/',
        },
      }),
    );
    expect(markStorageMigrationDone).not.toHaveBeenCalled();
  });

  it('shows the loading screen until the bundled document has been read', async () => {
    let resolveHtml: ((html: string) => void) | undefined;
    loadEmbeddedWalletHtml.mockReturnValue(
      new Promise<string>((resolve) => {
        resolveHtml = resolve;
      }),
    );
    await act(async () => {
      screen = create(<QRLWebView webSource="embedded" />);
    });
    expect(screen.root.findAllByType('NativeWebView' as never)).toHaveLength(0);
    expect(screen.root.findByType('QuantumLoadingScreen' as never).props.visible).toBe(true);
    await act(async () => {
      resolveHtml?.(EMBEDDED_HTML);
      await Promise.resolve();
    });
    expect(screen.root.findAllByType('NativeWebView' as never)).toHaveLength(1);
  });

  it('surfaces a readable error when the bundled document cannot be read', async () => {
    loadEmbeddedWalletHtml.mockRejectedValue(new Error('asset missing'));
    await act(async () => {
      screen = create(<QRLWebView webSource="embedded" />);
    });
    await act(async () => {
      await Promise.resolve();
    });
    const text = JSON.stringify(screen.toJSON());
    expect(text).toContain('Could not open the wallet bundled with this app');
  });
});
