import React, { act, createRef } from 'react';
import { Linking, Platform } from 'react-native';
import { create, type ReactTestRenderer } from 'react-test-renderer';
import QRLWebView, { type QRLWebViewRef } from '../../components/QRLWebView';
import NativeBridge from '../NativeBridge';

const EMBEDDED_HTML =
  '<!doctype html><html lang="en"><head><title>wallet</title></head><body></body></html>';

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

  it('accepts a bridge message from the Android about:blank document', async () => {
    // Android loads the string with loadDataWithBaseURL(..., historyUrl=null),
    // so the wallet document reports about:blank. Before the normaliser every
    // bridge message was dropped here and SEED_STORED never reached native.
    jest.replaceProperty(Platform, 'OS', 'android');
    const view = await renderEmbedded();
    const message = JSON.stringify({ type: 'SEED_STORED', payload: { address: 'Q00' } });
    for (const url of ['about:blank', 'about:blank#/transfer', 'https://qrlwallet.com/']) {
      (NativeBridge.handle as jest.Mock).mockClear();
      await act(async () => view.props.onMessage({ nativeEvent: { data: message, url } }));
      expect(NativeBridge.handle).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'SEED_STORED' }),
      );
    }
  });

  it('still drops a bridge message from any other document', async () => {
    jest.replaceProperty(Platform, 'OS', 'android');
    const view = await renderEmbedded();
    const message = JSON.stringify({ type: 'SEED_STORED', payload: { address: 'Q00' } });
    for (const url of [
      'about:srcdoc',
      'about:blank?x=1',
      'https://attacker.invalid/',
      'http://qrlwallet.com/',
      'file:///wallet/index.html',
      undefined,
    ]) {
      (NativeBridge.handle as jest.Mock).mockClear();
      await act(async () => view.props.onMessage({ nativeEvent: { data: message, url } }));
      expect(NativeBridge.handle).not.toHaveBeenCalled();
    }
  });

  it('never accepts about:blank as the wallet document in remote mode', async () => {
    jest.replaceProperty(Platform, 'OS', 'android');
    await act(async () => {
      screen = create(<QRLWebView webSource="remote" />, {
        createNodeMock: () => webViewNodeMock,
      });
    });
    const view = screen.root.findByType('NativeWebView' as never);
    const message = JSON.stringify({ type: 'SEED_STORED', payload: { address: 'Q00' } });
    (NativeBridge.handle as jest.Mock).mockClear();
    await act(async () =>
      view.props.onMessage({ nativeEvent: { data: message, url: 'about:blank' } }),
    );
    expect(NativeBridge.handle).not.toHaveBeenCalled();
    await act(async () =>
      view.props.onMessage({ nativeEvent: { data: message, url: 'https://qrlwallet.com/' } }),
    );
    expect(NativeBridge.handle).toHaveBeenCalledTimes(1);
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
