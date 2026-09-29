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
jest.mock('../NativeBridge', () => ({
  setWebViewRef: jest.fn(),
  resetWebAppReady: jest.fn(),
  sendQRResult: jest.fn(),
  handle: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../EmbeddedWalletDocument', () => {
  const actual = jest.requireActual('../EmbeddedWalletDocument.ts') as Record<string, unknown>;
  return {
    EMBEDDED_FLAG_SCRIPT: actual.EMBEDDED_FLAG_SCRIPT,
    withEmbeddedFlag: actual.withEmbeddedFlag,
    EMBEDDED_WALLET_BUILD_INFO: { frontendCommitShort: 'abcdef123456' },
    loadEmbeddedWalletHtml: jest.fn(),
  };
});

const { loadEmbeddedWalletHtml, withEmbeddedFlag } = jest.requireMock('../EmbeddedWalletDocument') as {
  loadEmbeddedWalletHtml: jest.Mock;
  withEmbeddedFlag: (html: string) => string;
};

describe('embedded QRLWebView', () => {
  let screen: ReactTestRenderer;
  const runtime = globalThis as typeof globalThis & { __DEV__: boolean };
  const originalDev = __DEV__;

  const webViewNodeMock = { injectJavaScript: jest.fn(), reload: jest.fn(), goBack: jest.fn() };

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
    loadEmbeddedWalletHtml.mockResolvedValue(withEmbeddedFlag(EMBEDDED_HTML));
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
    // The flag has to be the first script in the head, ahead of the wallet.
    expect(view.props.source.html).toContain('<head><script>window.__QRL_EMBEDDED__ = true;</script>');
    expect(view.props.originWhitelist).toEqual(['https://qrlwallet.com', 'about:*']);
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

  it('spends the one document allowance on Android, where the guard never runs', async () => {
    // loadDataWithBaseURL does not go through shouldOverrideUrlLoading, so the
    // injected document never reaches the guard on Android. Without spending
    // the allowance at document start, the first real navigation to
    // https://qrlwallet.com/ would be admitted and would fetch the live page.
    jest.replaceProperty(Platform, 'OS', 'android');
    const view = await renderEmbedded();
    await act(async () => view.props.onLoadStart({ nativeEvent: { loading: true } }));
    expect(view.props.onShouldStartLoadWithRequest({ url: 'https://qrlwallet.com/' })).toBe(false);
    // A hash route inside the document is still fine.
    expect(
      view.props.onShouldStartLoadWithRequest({ url: 'https://qrlwallet.com/#/transfer' }),
    ).toBe(true);
  });

  it('admits the document again after a recovery reload on Android', async () => {
    jest.replaceProperty(Platform, 'OS', 'android');
    const ref = createRef<QRLWebViewRef>();
    const view = await renderEmbedded(ref);
    await act(async () => view.props.onLoadStart({ nativeEvent: { loading: true } }));
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
    const firstKey = view.props.source;
    // The guard has consumed the one allowed base-URL load.
    view.props.onShouldStartLoadWithRequest({ url: 'https://qrlwallet.com/' });
    expect(view.props.onShouldStartLoadWithRequest({ url: 'https://qrlwallet.com/' })).toBe(false);

    await act(async () => view.props.onContentProcessDidTerminate());
    expect(NativeBridge.resetWebAppReady).toHaveBeenCalled();

    const recovered = screen.root.findByType('NativeWebView' as never);
    expect(recovered.props.source).toEqual(firstKey);
    // A fresh document load is admitted again.
    expect(recovered.props.onShouldStartLoadWithRequest({ url: 'https://qrlwallet.com/' })).toBe(true);
  });

  it('recovers the same way from an Android render process death', async () => {
    jest.replaceProperty(Platform, 'OS', 'android');
    const view = await renderEmbedded();
    expect(view.props.onRenderProcessGone).toBe(view.props.onContentProcessDidTerminate);
    view.props.onShouldStartLoadWithRequest({ url: 'https://qrlwallet.com/' });
    await act(async () => view.props.onRenderProcessGone({ nativeEvent: { didCrash: true } }));
    const recovered = screen.root.findByType('NativeWebView' as never);
    expect(recovered.props.onShouldStartLoadWithRequest({ url: 'https://qrlwallet.com/' })).toBe(true);
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
      withEmbeddedFlag('<!doctype html><html><head><title>v2</title></head><body></body></html>'),
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
      resolveHtml?.(withEmbeddedFlag(EMBEDDED_HTML));
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
